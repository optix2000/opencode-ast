import type { Node, Tree } from "web-tree-sitter"
import { symbolsWithNodes } from "./outline"
import { isValidKind, unknownKindsMessage } from "./util"

const lines = (allLines: string[], start: number, end: number) => {
  return allLines
    .slice(start - 1, end)
    .map((row, idx) => `${start + idx}: ${row}`)
    .join("\n")
}

const sigEnd = (node: Node): number => {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child) continue
    if (
      [
        "block",
        "compound_statement",
        "function_body",
        "declaration_list",
        "field_declaration_list",
        "enum_variant_list",
        "class_body",
        "statement_block",
      ].includes(child.type)
    ) {
      return child.startPosition.row + 1
    }
  }
  return node.startPosition.row + 1
}

export const extract = (
  tree: Tree,
  source: string,
  lang: string,
  kind?: string,
  name?: string,
  signature?: boolean,
): string => {
  if (!kind && !name) {
    return "Provide `name` or `kind` to extract a symbol"
  }
  const all = symbolsWithNodes(tree, lang, true)
  if (kind && !isValidKind(kind.toLowerCase())) {
    const available = [...new Set(all.map((row) => row.kind))].sort()
    return unknownKindsMessage([kind], available)
  }
  const rows = all.filter((row) => {
    const okName = name ? row.name === name : true
    const okKind = kind ? row.kind === kind.toLowerCase() : true
    return okName && okKind
  })
  if (!rows.length) {
    const available = [...new Set(all.map((row) => row.kind))].sort()
    const list = all.map((row) => `${row.name} (${row.kind})`).join("\n  ")
    if (!list) return "Symbol not found"
    return `Symbol not found\nAvailable symbols:\n  ${list}\nValid kinds for this file: ${available.join(", ")}`
  }
  const allLines = source.split("\n")
  return rows
    .map((row) => {
      const end = signature ? sigEnd(row.node) : row.end
      const head = `// ${row.kind} ${row.name} (lines ${row.start}-${end})`
      return `${head}\n${lines(allLines, row.start, end)}`
    })
    .join("\n\n")
}
