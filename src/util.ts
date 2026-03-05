import type { Node } from "web-tree-sitter"

export const isDefined = <T>(val: T | null | undefined): val is T =>
  val !== null && val !== undefined

const wrappers = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
] as const

export const unquote = (txt: string) => {
  const out = txt.trim()
  for (const [start, end] of wrappers) {
    if (out.startsWith(start) && out.endsWith(end)) {
      return out.slice(1, -1)
    }
  }
  return out
}

export const cleanImportSource = (txt: string) => {
  const out = unquote(txt.trim().replace(/;+$/, ""))
  if (out.startsWith("<") && out.endsWith(">")) return out.slice(1, -1)
  return out
}

const list = ["describe", "it", "test", "beforeEach", "afterEach"]
const callbackNodes = ["arrow_function", "function_expression"]
const labelNodes = ["string", "template_string"]

const hasAttr = (node: Node, childType: string, keyword: string): boolean => {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child?.type === childType && child.text.includes(keyword)) return true
  }
  const prev = node.previousNamedSibling
  return !!(prev?.type === childType && prev.text.includes(keyword))
}

const isKnownJsTestCall = (node: Node): boolean => {
  const fn = node.childForFieldName("function")
  if (!fn) return false
  const base = fn.text.split(".")[0] ?? fn.text
  if (!list.includes(base)) return false
  const args = node.childForFieldName("arguments")
  if (!args) return false
  const hasCallback = (() => {
    for (let i = 0; i < args.namedChildCount; i++) {
      const child = args.namedChild(i)
      if (child && callbackNodes.includes(child.type)) return true
    }
    return false
  })()
  if (!hasCallback) return false
  if (base === "beforeEach" || base === "afterEach") return true
  const first = args.namedChild(0)
  return !!first && labelNodes.includes(first.type)
}

export const isTest = (node: Node, lang: string): boolean => {
  let cur: Node | null = node
  while (cur) {
    if (lang === "rust") {
      if (
        cur.type === "mod_item" &&
        hasAttr(cur, "attribute_item", "cfg(test)")
      )
        return true
      if (
        cur.type === "function_item" &&
        hasAttr(cur, "attribute_item", "test")
      )
        return true
    }
    if (lang === "go" && cur.type === "function_declaration") {
      const name = cur.childForFieldName("name")
      if (
        name &&
        (name.text.startsWith("Test") || name.text.startsWith("Benchmark"))
      ) {
        return true
      }
    }
    if (lang === "python") {
      if (cur.type === "function_definition") {
        const name = cur.childForFieldName("name")
        if (name && name.text.startsWith("test_")) return true
      }
    }
    if (
      (lang === "typescript" || lang === "tsx" || lang === "javascript") &&
      cur.type === "call_expression"
    ) {
      if (isKnownJsTestCall(cur)) return true
    }
    if (lang === "java" && cur.type === "method_declaration") {
      if (hasAttr(cur, "marker_annotation", "Test")) return true
    }
    if (lang === "csharp" && cur.type === "method_declaration") {
      if (
        hasAttr(cur, "attribute_list", "Test") ||
        hasAttr(cur, "attribute_list", "Fact")
      )
        return true
    }
    cur = cur.parent
  }
  return false
}

/** Kinds that are useful for filtering in outline/extract. */
export const validKinds = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "struct",
  "trait",
  "impl",
  "namespace",
  "variable",
  "macro",
  "key",
  "heading",
  "symbol",
] as const

export type ValidKind = (typeof validKinds)[number]

const validKindSet = new Set<string>(validKinds)

/** Check whether a kind string is a recognised filterable kind. */
export const isValidKind = (k: string): k is ValidKind => validKindSet.has(k)

export const unknownKindsMessage = (invalid: string[], available: string[]) => {
  const title = `Unknown kind${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`
  const kinds = available.length ? available.join(", ") : "(none)"
  return `${title}\nValid kinds for this file: ${kinds}\nAll valid kinds: ${validKinds.join(", ")}`
}

export const kinds = new Map<string, string>([
  ["function_declaration", "function"],
  ["function_definition", "function"],
  ["function_item", "function"],
  ["function_declarator", "function"],
  ["function_expression", "function"],
  ["arrow_function", "function"],
  ["method_declaration", "method"],
  ["method_definition", "method"],
  ["method", "method"],
  ["singleton_method", "method"],
  ["constructor_declaration", "method"],
  ["class_declaration", "class"],
  ["class_definition", "class"],
  ["class_specifier", "class"],
  ["class", "class"],
  ["interface_declaration", "interface"],
  ["type_alias_declaration", "type"],
  ["type_item", "type"],
  ["type_definition", "type"],
  ["type_spec", "type"],
  ["type_declaration", "type"],
  ["enum_declaration", "enum"],
  ["enum_item", "enum"],
  ["enum_specifier", "enum"],
  ["struct_item", "struct"],
  ["struct_specifier", "struct"],
  ["struct_declaration", "struct"],
  ["trait_item", "trait"],
  ["impl_item", "impl"],
  ["namespace_definition", "namespace"],
  ["namespace_declaration", "namespace"],
  ["internal_module", "namespace"],
  ["module", "namespace"],
  ["variable_declarator", "variable"],
  ["init_declarator", "variable"],
  ["pair", "key"],
  ["block_mapping_pair", "key"],
  ["flow_pair", "key"],
  ["macro_definition", "macro"],
  ["atx_heading", "heading"],
  ["section", "section"],
  ["object", "object"],
  ["array", "array"],
  ["block_quote", "blockquote"],
  ["list", "list"],
  ["list_item", "list item"],
  ["fenced_code_block", "code block"],
  ["block_mapping", "mapping"],
  ["flow_mapping", "mapping"],
  ["block_sequence", "sequence"],
  ["flow_sequence", "sequence"],
  ["if_statement", "if block"],
  ["if_expression", "if block"],
  ["for_statement", "for loop"],
  ["for_in_statement", "for loop"],
  ["for_expression", "for loop"],
  ["foreach_statement", "for loop"],
  ["enhanced_for_statement", "for loop"],
  ["while_statement", "while loop"],
  ["while_expression", "while loop"],
  ["try_statement", "try block"],
  ["switch_statement", "switch block"],
  ["switch_expression", "switch block"],
  ["match_expression", "match block"],
])
