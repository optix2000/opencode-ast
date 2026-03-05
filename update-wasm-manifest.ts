#!/usr/bin/env bun

import { createHash } from "node:crypto"
import path from "node:path"

type ManifestGrammar = {
  id: string
  url: string
  sha256: string
  exts: string[]
}

type WasmManifest = {
  runtime: {
    url: string
    sha256: string
  }
  grammars: ManifestGrammar[]
}

const FETCH_TIMEOUT_MS = 20000
const manifestPath = path.join(import.meta.dir, "src", "wasm-manifest.json")
const USER_AGENT = "opencode-ast-wasm-manifest-updater"

type Options = {
  bumpLatest: boolean
  only?: string
  help: boolean
}

const usage = [
  "Usage:",
  "  bun run update:wasm-manifest [-- --bump-latest] [--only <id>]",
  "",
  "Options:",
  "  --bump-latest       Resolve each selected wasm URL to latest available release",
  "  --only <id>         Update only one target (runtime or a grammar id)",
  "  -h, --help          Show this help",
].join("\n")

const parseArgs = (argv: string[]): Options => {
  const out: Options = {
    bumpLatest: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue
    if (arg === "--bump-latest") {
      out.bumpLatest = true
      continue
    }
    if (arg === "--only") {
      const val = argv[i + 1]
      if (!val || val.startsWith("-")) {
        throw new Error("--only requires a target id")
      }
      out.only = val
      i++
      continue
    }
    if (arg === "-h" || arg === "--help") {
      out.help = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

const withTimeout = async <T>(fn: (signal: AbortSignal) => Promise<T>) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

const fetchJson = async <T>(url: string): Promise<T> => {
  return withTimeout(async (signal) => {
    const res = await fetch(url, {
      signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.github+json",
      },
    })
    if (!res.ok) {
      throw new Error(`failed (${res.status} ${res.statusText})`)
    }
    return (await res.json()) as T
  })
}

const downloadHash = async (url: string) => {
  return withTimeout(async (signal) => {
    const res = await fetch(url, {
      signal,
      headers: { "User-Agent": USER_AGENT },
    })
    if (!res.ok) {
      throw new Error(`failed (${res.status} ${res.statusText})`)
    }
    const body = await res.arrayBuffer()
    if (!body.byteLength) {
      throw new Error("downloaded empty body")
    }
    return hash(new Uint8Array(body))
  })
}

const latestRuntimeUrl = async () => {
  type NpmMetadata = { "dist-tags"?: { latest?: string } }
  const meta = await fetchJson<NpmMetadata>(
    "https://registry.npmjs.org/web-tree-sitter",
  )
  const latest = meta["dist-tags"]?.latest
  if (!latest) {
    throw new Error("Could not resolve latest web-tree-sitter version from npm")
  }
  return `https://unpkg.com/web-tree-sitter@${latest}/web-tree-sitter.wasm`
}

export type GithubRelease = {
  draft: boolean
  prerelease: boolean
  assets: Array<{ name: string; browser_download_url: string }>
  tag_name: string
}

export const findLatestAssetUrl = (
  releases: GithubRelease[],
  assetName: string,
): string | undefined => {
  const found = releases
    .filter((row) => !row.draft && !row.prerelease)
    .map((row) => row.assets.find((asset) => asset.name === assetName))
    .find((row) => !!row)
  return found?.browser_download_url
}

const latestGithubAssetUrl = async (currentUrl: string) => {
  const parsed = new URL(currentUrl)
  if (parsed.hostname !== "github.com") {
    throw new Error(`Unsupported host for grammar URL: ${parsed.hostname}`)
  }
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts.length < 6 || parts[2] !== "releases" || parts[3] !== "download") {
    throw new Error(`Unsupported GitHub release URL shape: ${currentUrl}`)
  }
  const owner = parts[0]
  const repo = parts[1]
  const assetName = parts.slice(5).join("/")

  const releases = await fetchJson<GithubRelease[]>(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`,
  )
  const found = findLatestAssetUrl(releases, assetName)
  if (!found) {
    throw new Error(
      `No release asset named '${assetName}' found for ${owner}/${repo}`,
    )
  }
  return found
}

const main = async (argv: string[]) => {
  const opts = parseArgs(argv)

  if (opts.help) {
    console.log(usage)
    process.exit(0)
  }

  const raw = (await Bun.file(manifestPath).json()) as WasmManifest
  const validTargets = new Set<string>([
    "runtime",
    ...raw.grammars.map((row) => row.id),
  ])

  if (opts.only && !validTargets.has(opts.only)) {
    throw new Error(
      `Unknown target '${opts.only}'. Valid targets: ${[...validTargets].join(", ")}`,
    )
  }

  const selectedRuntime = !opts.only || opts.only === "runtime"
  const selectedGrammars = raw.grammars.filter(
    (row) => !opts.only || row.id === opts.only,
  )

  if (opts.bumpLatest && selectedRuntime) {
    const next = await latestRuntimeUrl()
    if (next !== raw.runtime.url) {
      console.log(
        `Bumping runtime URL:\n  old: ${raw.runtime.url}\n  new: ${next}`,
      )
      raw.runtime.url = next
    }
  }

  if (opts.bumpLatest) {
    for (const row of selectedGrammars) {
      const next = await latestGithubAssetUrl(row.url)
      if (next !== row.url) {
        console.log(`Bumping ${row.id} URL:\n  old: ${row.url}\n  new: ${next}`)
        row.url = next
      }
    }
  }

  if (selectedRuntime) {
    console.log(`Updating runtime checksum: ${raw.runtime.url}`)
    raw.runtime.sha256 = await downloadHash(raw.runtime.url)
  }

  for (const row of selectedGrammars) {
    console.log(`Updating ${row.id} checksum: ${row.url}`)
    row.sha256 = await downloadHash(row.url)
  }

  await Bun.write(manifestPath, `${JSON.stringify(raw, null, 2)}\n`)
  console.log(`Updated ${manifestPath}`)
}

if (import.meta.main) {
  await main(process.argv.slice(2))
}
