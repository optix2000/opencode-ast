import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { mkdir, rename, stat, unlink } from "node:fs/promises"
import { Query as TreeQuery } from "web-tree-sitter"
import type { Language, Query, Tree } from "web-tree-sitter"
import { lookup, runtimeWasm } from "./grammars"

const DOWNLOAD_ATTEMPTS = 3
const FETCH_TIMEOUT_MS = 15000
const DEFAULT_MAX_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_QUERIES_PER_LANG = 100

const root = path.join(os.homedir(), ".cache", "opencode-ast")
const langs = new Map<string, Language>()
const queries = new Map<string, Map<string, Query>>()
const files = new Map<string, Promise<string>>()
const verified = new Set<string>()
let mod: Promise<typeof import("web-tree-sitter")> | undefined
let init: Promise<void> | undefined

const sourceSizeLimit = () => {
  const raw = process.env.OPENCODE_AST_MAX_SOURCE_BYTES
  if (!raw) return DEFAULT_MAX_SOURCE_BYTES
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_SOURCE_BYTES
  return Math.floor(parsed)
}

const cxxHeaderSignals = [
  /^\s*namespace\s+[A-Za-z_]\w*/m,
  /^\s*template\s*</m,
  /^\s*class\s+[A-Za-z_]\w*/m,
  /\bstd::/,
  /\btypename\b/,
  /\bconstexpr\b/,
  /::/,
]

const looksLikeCppHeader = (src: string) =>
  cxxHeaderSignals.some((re) => re.test(src))

const pickConfig = (
  ext: string,
  src: string,
  base: ReturnType<typeof lookup> | undefined,
) => {
  if (!base) return
  if (ext !== ".h") return base
  if (looksLikeCppHeader(src)) {
    return lookup(".hpp") ?? base
  }
  return lookup(".c") ?? base
}

const disposeQuery = (one: Query | undefined) => {
  if (!one) return
  const maybe = one as Query & { delete?: () => void }
  maybe.delete?.()
}

const hashBytes = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

const hashFile = async (filePath: string) => {
  const out = await Bun.file(filePath).arrayBuffer()
  return hashBytes(new Uint8Array(out))
}

const assertDigest = (url: string, expected: string, actual: string) => {
  if (actual === expected) return
  throw new DownloadError(
    `wasm checksum mismatch for ${url} (expected ${expected.slice(0, 12)}..., got ${actual.slice(0, 12)}...)`,
    false,
  )
}

const keyFor = (url: string, sha256: string) => `${url}#${sha256}`

class DownloadError extends Error {
  retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = "DownloadError"
    this.retryable = retryable
  }
}

const isRetryableStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500

const isRetryableError = (err: unknown) => {
  if (err instanceof DownloadError) return err.retryable
  if (err instanceof DOMException && err.name === "AbortError") return true
  return err instanceof TypeError
}

const load = async () => {
  if (mod) return mod
  mod = import("web-tree-sitter").catch((err) => {
    mod = undefined
    throw err
  })
  return mod
}

const ready = async () => {
  if (init) return init
  init = (async () => {
    const lib = await load()
    const wasm = await file(runtimeWasm.url, runtimeWasm.sha256)
    await lib.Parser.init({ locateFile: () => wasm })
  })().catch((err) => {
    init = undefined
    throw err
  })
  return init
}

const cacheName = (url: string, sha256: string) => {
  const parsed = new URL(url)
  const base = path.basename(parsed.pathname)
  const ext = path.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12)
  const pin = sha256.slice(0, 12)
  return ext ? `${stem}-${hash}-${pin}${ext}` : `${base}-${hash}-${pin}`
}

const hasCache = async (out: string) => {
  try {
    const info = await stat(out)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

const download = async (url: string, out: string, sha256: string) => {
  const fetchWasm = async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) {
        throw new DownloadError(
          `failed to download wasm (${res.status} ${res.statusText}): ${url}`,
          isRetryableStatus(res.status),
        )
      }
      const body = await res.arrayBuffer()
      if (!body.byteLength) {
        throw new DownloadError(`downloaded empty wasm: ${url}`, true)
      }
      const digest = hashBytes(new Uint8Array(body))
      assertDigest(url, sha256, digest)
      return body
    } catch (err) {
      if (err instanceof DownloadError) throw err
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new DownloadError(
          `timed out downloading wasm after ${FETCH_TIMEOUT_MS}ms: ${url}`,
          true,
        )
      }
      const reason = err instanceof Error ? err.message : String(err)
      throw new DownloadError(
        `failed to download wasm: ${url} (${reason})`,
        true,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  let last: unknown
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    const tmp = `${out}.tmp-${process.pid}-${Date.now()}-${attempt}`
    try {
      const body = await fetchWasm()
      await Bun.write(tmp, body)
      await rename(tmp, out)
      return
    } catch (err) {
      last = err
      await unlink(tmp).catch(() => undefined)
      if (!isRetryableError(err) || attempt === DOWNLOAD_ATTEMPTS) {
        throw err
      }
    }
  }
  throw last
}

const file = async (url: string, sha256: string) => {
  const key = keyFor(url, sha256)
  const hit = files.get(key)
  if (hit) return hit
  const out = (async () => {
    await mkdir(root, { recursive: true })
    const target = path.join(root, cacheName(url, sha256))
    if (await hasCache(target)) {
      if (!verified.has(key)) {
        try {
          const cached = await hashFile(target)
          assertDigest(url, sha256, cached)
          verified.add(key)
        } catch {
          await unlink(target).catch(() => undefined)
          await download(url, target, sha256)
          verified.add(key)
        }
      }
      return target
    }
    await unlink(target).catch(() => undefined)
    await download(url, target, sha256)
    if (!(await hasCache(target))) {
      throw new Error(`failed to cache wasm: ${url}`)
    }
    verified.add(key)
    return target
  })()
  files.set(key, out)
  try {
    return await out
  } finally {
    if (files.get(key) === out) files.delete(key)
  }
}

const lang = async (id: string, wasm: string, sha256: string) => {
  const hit = langs.get(id)
  if (hit) return hit
  await ready()
  const lib = await load()
  let out = await file(wasm, sha256)
  let next: Language
  try {
    next = await lib.Language.load(out)
  } catch {
    await unlink(out).catch(() => undefined)
    verified.delete(keyFor(wasm, sha256))
    out = await file(wasm, sha256)
    next = await lib.Language.load(out)
  }
  langs.set(id, next)
  return next
}

export const parse = async (
  file: string,
): Promise<{ tree: Tree; lang: string; src: string }> => {
  const ext = path.extname(file).toLowerCase()
  const base = lookup(ext)
  if (!base) {
    throw new Error(`unsupported file extension: ${ext || "(none)"}`)
  }
  const info = await stat(file)
  const maxSourceBytes = sourceSizeLimit()
  if (info.size > maxSourceBytes) {
    throw new Error(
      `source file exceeds limit (${info.size} bytes > ${maxSourceBytes} bytes): ${file}`,
    )
  }
  const src = await Bun.file(file).text()
  const cfg = pickConfig(ext, src, base)
  if (!cfg) {
    throw new Error(`unsupported file extension: ${ext || "(none)"}`)
  }
  const one = await lang(cfg.id, cfg.wasm, cfg.sha256)
  await ready()
  const lib = await load()
  const p = new lib.Parser()
  try {
    p.setLanguage(one)
    const tree = p.parse(src)
    if (!tree) {
      throw new Error(`failed to parse file: ${file}`)
    }
    return { tree, lang: cfg.id, src }
  } finally {
    p.delete()
  }
}

export const query = (lang: string, source: string): Query => {
  const one = langs.get(lang)
  if (!one) {
    throw new Error(`language not loaded: ${lang}`)
  }
  const bucket = queries.get(lang) ?? new Map<string, Query>()
  const hit = bucket.get(source)
  if (hit) {
    bucket.delete(source)
    bucket.set(source, hit)
    queries.set(lang, bucket)
    return hit
  }
  if (bucket.size >= MAX_QUERIES_PER_LANG) {
    const oldest = bucket.keys().next().value
    if (oldest !== undefined) {
      disposeQuery(bucket.get(oldest))
      bucket.delete(oldest)
    }
  }
  const out = new TreeQuery(one, source)
  bucket.set(source, out)
  queries.set(lang, bucket)
  return out
}

export const __queryCacheSize = (lang: string) => queries.get(lang)?.size ?? 0
export const __queryCacheLimit = MAX_QUERIES_PER_LANG
