import manifest from "./wasm-manifest.json"

const ts_outline = `
(function_declaration name: (identifier) @name) @def
(class_declaration name: (type_identifier) @name) @def
(interface_declaration name: (type_identifier) @name) @def
(type_alias_declaration name: (type_identifier) @name) @def
(enum_declaration name: (identifier) @name) @def
(internal_module name: (identifier) @name) @def
(export_statement declaration: (function_declaration name: (identifier) @name)) @def
(export_statement declaration: (class_declaration name: (type_identifier) @name)) @def
(export_statement declaration: (interface_declaration name: (type_identifier) @name)) @def
(export_statement declaration: (type_alias_declaration name: (type_identifier) @name)) @def
(export_statement declaration: (enum_declaration name: (identifier) @name)) @def
(export_statement declaration: (internal_module name: (identifier) @name)) @def
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name))) @def
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @def
(lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @def
`

const js_outline = `
(function_declaration name: (identifier) @name) @def
(class_declaration name: (identifier) @name) @def
(export_statement declaration: (function_declaration name: (identifier) @name)) @def
(export_statement declaration: (class_declaration name: (identifier) @name)) @def
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name))) @def
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @def
(lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @def
`

const es_imports = `
(import_statement source: (string) @source) @import
(export_statement source: (string) @source) @import
(call_expression function: (identifier) @fn (#eq? @fn "require") arguments: (arguments (string) @source)) @import
(call_expression function: (import) arguments: (arguments (string) @source)) @import
`

const es_scopes = [
  "function_declaration",
  "method_definition",
  "class_declaration",
  "arrow_function",
  "function_expression",
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "try_statement",
  "switch_statement",
] as const

const typescript = {
  outline: ts_outline,
  imports: es_imports,
  scopes: es_scopes,
} as const

export const queries = {
  typescript,
  tsx: typescript,
  javascript: {
    outline: js_outline,
    imports: es_imports,
    scopes: es_scopes,
  },
  python: {
    outline: `
(function_definition name: (identifier) @name) @def
(class_definition name: (identifier) @name) @def
(decorated_definition definition: (function_definition name: (identifier) @name)) @def
(decorated_definition definition: (class_definition name: (identifier) @name)) @def
`,
    imports: `
(import_statement) @import
(import_from_statement module_name: (dotted_name) @source) @import
(import_from_statement module_name: (relative_import) @source) @import
(import_from_statement (relative_import) @source) @import
`,
    scopes: [
      "function_definition",
      "class_definition",
      "lambda",
      "if_statement",
      "for_statement",
      "while_statement",
      "with_statement",
      "try_statement",
    ],
  },
  go: {
    outline: `
(function_declaration name: (identifier) @name) @def
(method_declaration name: (field_identifier) @name) @def
(type_declaration (type_spec name: (type_identifier) @name)) @def
`,
    imports: `(import_spec path: (interpreted_string_literal) @source) @import`,
    scopes: [
      "function_declaration",
      "method_declaration",
      "type_declaration",
      "if_statement",
      "for_statement",
      "switch_statement",
      "block",
    ],
  },
  rust: {
    outline: `
(function_item name: (identifier) @name) @def
(struct_item name: (type_identifier) @name) @def
(enum_item name: (type_identifier) @name) @def
(trait_item name: (type_identifier) @name) @def
(impl_item type: (type_identifier) @name) @def
(type_item name: (type_identifier) @name) @def
(const_item name: (identifier) @name) @def
(static_item name: (identifier) @name) @def
(macro_definition name: (identifier) @name) @def
`,
    imports: `(use_declaration) @import`,
    scopes: [
      "function_item",
      "struct_item",
      "enum_item",
      "impl_item",
      "trait_item",
      "mod_item",
      "if_expression",
      "for_expression",
      "while_expression",
      "loop_expression",
      "match_expression",
      "block",
    ],
  },
  java: {
    outline: `
(method_declaration name: (identifier) @name) @def
(class_declaration name: (identifier) @name) @def
(interface_declaration name: (identifier) @name) @def
(enum_declaration name: (identifier) @name) @def
(constructor_declaration name: (identifier) @name) @def
`,
    imports: `(import_declaration) @import`,
    scopes: [
      "method_declaration",
      "constructor_declaration",
      "class_declaration",
      "interface_declaration",
      "enum_declaration",
      "if_statement",
      "for_statement",
      "enhanced_for_statement",
      "while_statement",
      "try_statement",
      "switch_expression",
      "switch_statement",
    ],
  },
  c: {
    outline: `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def
(declaration declarator: (function_declarator declarator: (identifier) @name)) @def
(declaration declarator: (init_declarator declarator: (identifier) @name)) @def
(declaration declarator: (init_declarator declarator: (array_declarator declarator: (identifier) @name))) @def
(struct_specifier name: (type_identifier) @name) @def
(enum_specifier name: (type_identifier) @name) @def
(type_definition declarator: (type_identifier) @name) @def
`,
    imports: `(preproc_include path: (_) @source) @import`,
    scopes: [
      "function_definition",
      "if_statement",
      "for_statement",
      "while_statement",
      "switch_statement",
      "compound_statement",
      "struct_specifier",
    ],
  },
  cpp: {
    outline: `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def
(function_definition declarator: (function_declarator declarator: (qualified_identifier) @name)) @def
(declaration declarator: (function_declarator declarator: (identifier) @name)) @def
(declaration declarator: (init_declarator declarator: (identifier) @name)) @def
(declaration declarator: (init_declarator declarator: (array_declarator declarator: (identifier) @name))) @def
(class_specifier name: (type_identifier) @name) @def
(struct_specifier name: (type_identifier) @name) @def
(enum_specifier name: (type_identifier) @name) @def
(type_definition declarator: (type_identifier) @name) @def
(namespace_definition name: (namespace_identifier) @name) @def
(template_declaration (function_definition declarator: (function_declarator declarator: (identifier) @name))) @def
(template_declaration (class_specifier name: (type_identifier) @name)) @def
`,
    imports: `(preproc_include path: (_) @source) @import`,
    scopes: [
      "function_definition",
      "class_specifier",
      "struct_specifier",
      "namespace_definition",
      "if_statement",
      "for_statement",
      "while_statement",
      "switch_statement",
      "compound_statement",
    ],
  },
  ruby: {
    outline: `
(method name: (identifier) @name) @def
(singleton_method name: (identifier) @name) @def
(class name: (constant) @name) @def
(module name: (constant) @name) @def
`,
    imports: `(call method: (identifier) @method (#eq? @method "require") arguments: (argument_list (string) @source)) @import`,
    scopes: [
      "method",
      "singleton_method",
      "class",
      "module",
      "if",
      "for",
      "while",
      "case",
      "begin",
    ],
  },
  csharp: {
    outline: `
(method_declaration name: (identifier) @name) @def
(class_declaration name: (identifier) @name) @def
(interface_declaration name: (identifier) @name) @def
(enum_declaration name: (identifier) @name) @def
(struct_declaration name: (identifier) @name) @def
(constructor_declaration name: (identifier) @name) @def
(namespace_declaration name: (identifier) @name) @def
`,
    imports: `(using_directive) @import`,
    scopes: [
      "method_declaration",
      "constructor_declaration",
      "class_declaration",
      "interface_declaration",
      "struct_declaration",
      "namespace_declaration",
      "if_statement",
      "for_statement",
      "foreach_statement",
      "while_statement",
      "switch_statement",
    ],
  },
  json: {
    outline: `
(document
  (object
    (pair key: (string) @name) @def))
`,
    imports: ``,
    scopes: ["object", "array"],
  },
  yaml: {
    outline: `
(document
  (block_node
    (block_mapping
      (block_mapping_pair key: (_) @name) @def)))

(document
  (flow_node
    (flow_mapping
      (flow_pair key: (_) @name) @def)))
`,
    imports: ``,
    scopes: [
      "block_mapping",
      "block_sequence",
      "flow_mapping",
      "flow_sequence",
    ],
  },
  markdown: {
    outline: `
(section (atx_heading heading_content: (inline) @name) @def)
`,
    imports: ``,
    scopes: [
      "section",
      "block_quote",
      "list",
      "list_item",
      "fenced_code_block",
    ],
  },
} as const

export type QueryConfig = (typeof queries)[keyof typeof queries]

export const queryConfig = (lang: string): QueryConfig | undefined => {
  const key = lang as keyof typeof queries
  if (!(key in queries)) return
  return queries[key]
}

type GrammarEntry = { id: keyof typeof queries; wasm: string }

type ManifestGrammar = {
  id: GrammarEntry["id"]
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

const isSha256 = (txt: string) => /^[a-f0-9]{64}$/.test(txt)

const wasmManifest = manifest as WasmManifest

if (!isSha256(wasmManifest.runtime.sha256)) {
  throw new Error("Invalid runtime wasm sha256 in wasm-manifest.json")
}

for (const row of wasmManifest.grammars) {
  if (!isSha256(row.sha256)) {
    throw new Error(
      `Invalid grammar wasm sha256 for ${row.id} in wasm-manifest.json`,
    )
  }
}

export const runtimeWasm = wasmManifest.runtime

type GrammarLookupEntry = GrammarEntry & { sha256: string }

const entry = (row: ManifestGrammar): [string, GrammarLookupEntry][] =>
  row.exts.map((ext) => [
    ext,
    { id: row.id, wasm: row.url, sha256: row.sha256 },
  ])

export const grammars = new Map<string, GrammarLookupEntry>(
  wasmManifest.grammars.flatMap(entry),
)

export const lookup = (ext: string) => {
  const cfg = grammars.get(ext.toLowerCase())
  if (!cfg) return
  const set = queries[cfg.id]
  return {
    id: cfg.id,
    wasm: cfg.wasm,
    sha256: cfg.sha256,
    queries: set,
  }
}
