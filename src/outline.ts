import type { Node, Tree } from "web-tree-sitter"
import { queryConfig } from "./grammars"
import { query } from "./parser"
import {
  isTest,
  isValidKind,
  isDefined,
  kinds,
  unknownKindsMessage,
  unquote,
} from "./util"

const heads = new Map<string, string>([
  ["function", "Functions"],
  ["method", "Methods"],
  ["class", "Classes"],
  ["interface", "Interfaces"],
  ["type", "Types"],
  ["enum", "Enums"],
  ["struct", "Structs"],
  ["trait", "Traits"],
  ["impl", "Impls"],
  ["namespace", "Namespaces"],
  ["variable", "Variables"],
  ["key", "Keys"],
  ["heading", "Headings"],
  ["symbol", "Symbols"],
])

export type SymbolRow = {
  name: string
  kind: string
  start: number
  end: number
  exp: boolean
}

type SymbolMatch = SymbolRow & { node: Node }

const goKind = (name: Node) => {
  const spec = name.parent
  if (!spec || spec.type !== "type_spec") return
  const direct = spec.childForFieldName("type")
  if (direct?.type === "struct_type") return "struct"
  if (direct?.type === "interface_type") return "interface"
}

const nearbyNodes = (node: Node) =>
  [node, node.parent, node.parent?.parent].filter(isDefined)

const firstLine = (node: Node) => node.text.split("\n", 1)[0] ?? node.text

const kindFromTrail = (node: Node | null | undefined, max: number) => {
  let cur = node
  let depth = 0
  while (cur && depth < max) {
    const hit = kinds.get(cur.type)
    if (hit) return hit
    cur = cur.parent
    depth++
  }
}

const hasPublicModifier = (def: Node) => {
  const nodes = nearbyNodes(def)
  for (const node of nodes) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (
        (child.type === "modifiers" ||
          child.type === "modifier" ||
          child.type === "visibility_modifier") &&
        /\bpublic\b/.test(child.text)
      ) {
        return true
      }
    }
    if (/^\s*public\b/.test(firstLine(node))) return true
  }
  return false
}

const hasRustPub = (def: Node) => {
  const nodes = nearbyNodes(def)
  for (const node of nodes) {
    const vis = node.childForFieldName("visibility")
    if (vis && /^\s*pub(\b|\()/.test(vis.text)) return true
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type !== "visibility_modifier") continue
      if (/^\s*pub(\b|\()/.test(child.text)) return true
    }
    if (/^\s*pub(\b|\()/.test(firstLine(node))) return true
  }
  return false
}

const kind = (lang: string, name: Node, def: Node) => {
  if (lang === "go") {
    const hit = goKind(name)
    if (hit) return hit
  }
  return kindFromTrail(name.parent, 4) ?? kindFromTrail(def, 3) ?? "symbol"
}

const exp = (lang: string, def: Node, name: string) => {
  if (lang === "rust") {
    return hasRustPub(def)
  }
  if (lang === "go") {
    const first = name[0]
    return !!first && first >= "A" && first <= "Z"
  }
  if (lang === "java" || lang === "csharp") {
    return hasPublicModifier(def)
  }
  if (lang === "python") {
    return !name.startsWith("_")
  }
  if (def.type === "export_statement") return true
  if (def.parent?.type === "export_statement") return true
  return def.parent?.parent?.type === "export_statement"
}

export const symbolsWithNodes = (
  tree: Tree,
  lang: string,
  includeTests?: boolean,
): SymbolMatch[] => {
  const cfg = queryConfig(lang)
  if (!cfg) return []
  const out = query(lang, cfg.outline)
  const seen = new Set<string>()
  return out
    .matches(tree.rootNode)
    .map((row) => {
      const name = row.captures.find((cap) => cap.name === "name")
      const def = row.captures.find((cap) => cap.name === "def")
      if (!name || !def) return
      const rowKind = kind(lang, name.node, def.node)
      const rowName =
        rowKind === "key" ? unquote(name.node.text) : name.node.text
      return {
        name: rowName,
        kind: rowKind,
        start: def.node.startPosition.row + 1,
        end: def.node.endPosition.row + 1,
        exp: exp(lang, def.node, rowName),
        node: def.node,
      }
    })
    .filter(isDefined)
    .filter((row) => {
      const key = `${row.start}:${row.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .filter((row) => includeTests || !isTest(row.node, lang))
    .sort((a, b) => a.start - b.start)
}

export const symbols = (
  tree: Tree,
  lang: string,
  includeTests?: boolean,
): SymbolRow[] => {
  return symbolsWithNodes(tree, lang, includeTests).map((row) => ({
    name: row.name,
    kind: row.kind,
    start: row.start,
    end: row.end,
    exp: row.exp,
  }))
}

export const outline = (
  tree: Tree,
  lang: string,
  filter?: string,
  includeTests?: boolean,
): string => {
  const rows = symbols(tree, lang, includeTests)
  if (!rows.length) return "No symbols found"
  const set = rows.reduce((acc, row) => {
    const list = acc.get(row.kind) ?? []
    list.push(row)
    acc.set(row.kind, list)
    return acc
  }, new Map<string, typeof rows>())
  if (filter) {
    const requested = filter
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    const invalid = requested.filter((k) => !isValidKind(k))
    if (invalid.length) {
      const available = [...set.keys()].sort()
      return unknownKindsMessage(invalid, available)
    }
    const only = new Set(requested)
    for (const key of set.keys()) {
      if (!only.has(key)) set.delete(key)
    }
  }
  if (!set.size) return "No symbols found"
  return [...set.entries()]
    .map((entry) => {
      const key = entry[0]
      const list = entry[1]
      const head =
        heads.get(key) ?? `${key[0]?.toUpperCase() ?? "S"}${key.slice(1)}s`
      return `${head}:\n${list.map((row) => `  ${row.name} (lines ${row.start}-${row.end}${row.exp ? ", exported" : ""})`).join("\n")}`
    })
    .join("\n\n")
}
