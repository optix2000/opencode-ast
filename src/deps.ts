import type { Tree } from "web-tree-sitter"
import { queryConfig } from "./grammars"
import { query } from "./parser"
import { cleanImportSource, isTest } from "./util"

const includeTarget = (txt: string) => {
  const one = txt.trim()
  const match = one.match(/^#\s*include\s*(.+)$/)
  return (match?.[1] ?? one).trim()
}

const pick = (txt: string) => {
  const one = txt.trim()
  if (one.startsWith("import ")) {
    const body = one.slice(7).trim()
    const from = body.match(/\sfrom\s+/)
    if (!from) return cleanImportSource(body)
    const idx = from.index ?? -1
    if (idx < 0) return cleanImportSource(body)
    return cleanImportSource(body.slice(idx + from[0].length))
  }
  if (/^from\s+/.test(one)) {
    const from = one.match(/^from\s+([^\s]+)\s+import\b/)
    if (from?.[1]) return cleanImportSource(from[1])
    return cleanImportSource(one.slice(5))
  }
  if (one.startsWith("use ")) {
    return cleanImportSource(one.slice(4))
  }
  if (one.startsWith("using ")) {
    return cleanImportSource(one.slice(6))
  }
  if (/^#\s*include\b/.test(one)) {
    return cleanImportSource(includeTarget(one))
  }
  return cleanImportSource(one)
}

const local = (lang: string, txt: string, raw: string) => {
  const source = raw.trim()
  if (lang === "c" || lang === "cpp") {
    const include = includeTarget(source)
    if (include.startsWith('"') && include.endsWith('"')) return true
    if (include.startsWith("<") && include.endsWith(">")) return false
  }
  if (lang === "python" && source.startsWith("from .")) return true
  return (
    txt.startsWith(".") ||
    txt.startsWith("/") ||
    txt.startsWith("@/") ||
    txt.startsWith("crate::") ||
    txt.startsWith("super::") ||
    txt.startsWith("self::")
  )
}

export const deps = (
  tree: Tree,
  lang: string,
  includeTests?: boolean,
): string => {
  const cfg = queryConfig(lang)
  if (!cfg) return "No imports query for this language"
  if (!cfg.imports.trim()) return "No imports found"
  const unique = new Map<string, { txt: string; type: "local" | "external"; line: number }>()
  for (const row of query(lang, cfg.imports).matches(tree.rootNode)) {
    const src = row.captures.find((cap) => cap.name === "source")
    const imp = row.captures.find((cap) => cap.name === "import")
    const node = src?.node ?? imp?.node
    if (!node) continue
    if (!includeTests && isTest(node, lang)) continue
    const raw = src?.node.text ?? node.text
    const txt = src ? cleanImportSource(raw) : pick(raw)
    const type = local(lang, txt, raw) ? "local" : "external"
    const line = node.startPosition.row + 1
    const key = `${txt}:${type}:${line}`
    if (unique.has(key)) continue
    unique.set(key, {
      txt,
      type,
      line,
    })
  }
  if (!unique.size) return "No imports found"
  return `Imports:\n${[...unique.values()].map((row) => `  ${row.txt} (${row.type}, line ${row.line})`).join("\n")}`
}
