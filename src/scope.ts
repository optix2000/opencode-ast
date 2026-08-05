import type { Node, Tree } from "web-tree-sitter"
import { queryConfig } from "./grammars"
import { isDefined, kinds } from "./util"

const idTypes = [
  "identifier",
  "type_identifier",
  "field_identifier",
  "constant",
] as const

const firstId = (node: Node) =>
  node.descendantsOfType([...idTypes]).filter(isDefined)[0]

const name = (node: Node) => {
  const one = node.childForFieldName("name")
  if (one) return one.text
  const two = node.childForFieldName("declarator")
  if (two) {
    const txt = firstId(two)
    if (txt) return txt.text
  }
  return firstId(node)?.text
}

const text = (node: Node, lang: string) => {
  const tag = kinds.get(node.type) ?? "scope"
  const namedTerraformBlock = lang === "terraform" && node.type === "block"
  if (!namedTerraformBlock && (tag.endsWith("block") || tag.endsWith("loop"))) {
    return `${tag} (lines ${node.startPosition.row + 1}-${node.endPosition.row + 1})`
  }
  const id = name(node)
  if (!id)
    return `${tag} (lines ${node.startPosition.row + 1}-${node.endPosition.row + 1})`
  return `${id} (${tag}, lines ${node.startPosition.row + 1}-${node.endPosition.row + 1})`
}

export const scope = (tree: Tree, lang: string, line: number): string => {
  const cfg = queryConfig(lang)
  if (!cfg) return "No scope query for this language"
  if (line < 1) return "Line must be >= 1"
  const lineCount = tree.rootNode.endPosition.row + 1
  if (line > lineCount) {
    return `Line ${line} is outside the file (file has ${lineCount} lines)`
  }
  const row = line - 1
  const first = tree.rootNode.descendantForPosition({ row, column: 0 })
  const last = tree.rootNode.descendantForPosition({
    row,
    column: Number.MAX_SAFE_INTEGER,
  })
  const starts = [first, last].filter(isDefined)
  if (!starts.length) return `Line ${line} is outside the file`
  const set = new Set<string>(cfg.scopes)
  const all = [] as Node[]
  const seen = new Set<string>()
  for (const start of starts) {
    let cur: Node | null = start
    while (cur) {
      if (set.has(cur.type)) {
        const key = `${cur.type}:${cur.startIndex}:${cur.endIndex}`
        if (!seen.has(key)) {
          seen.add(key)
          all.push(cur)
        }
      }
      cur = cur.parent
    }
  }
  if (!all.length) return `Line ${line} is not inside a known scope`
  all.sort((a, b) => {
    const startDiff = a.startIndex - b.startIndex
    if (startDiff) return startDiff
    const spanDiff = b.endIndex - b.startIndex - (a.endIndex - a.startIndex)
    if (spanDiff) return spanDiff
    return a.endIndex - b.endIndex
  })
  const out = all
    .map((node, idx) => `${"  ".repeat(idx + 1)}${text(node, lang)}`)
    .join("\n")
  return `Line ${line} is inside:\n${out}`
}
