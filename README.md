# opencode-ast

AST plugin for [OpenCode V2](https://opencode.ai/v2/docs/) that parses source files with [tree-sitter](https://tree-sitter.github.io/) (via WASM) and exposes structural queries: outline, extract, deps, and scope.

Handles broken syntax fine since tree-sitter is error-tolerant. No language server involved.

## Supported languages

TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, C#, JSON, JSONC, YAML, Terraform, Markdown.

## Operations

### outline

Structural overview of a file — functions, classes, types with line ranges and export status.

```
ast { operation: "outline", filePath: "src/parser.ts" }
```

Output looks like:

```
Functions:
  parse (lines 57-76, exported)
  query (lines 78-84, exported)

Variables:
  ready (lines 24-32)
  load (lines 18-22)
```

You can pass `filter: "struct,function"` to limit output to specific kinds.

### extract

Pull one symbol's source by name. Optionally pass `kind` to disambiguate, or `signature: true` to get just the declaration line.

```
ast { operation: "extract", filePath: "src/parser.ts", name: "parse" }
ast { operation: "extract", filePath: "src/parser.ts", name: "Parser", kind: "class" }
```

### deps

List imports, classified as local or external.

```
ast { operation: "deps", filePath: "src/parser.ts" }
```

### scope

Given a line number, returns the enclosing scope chain.

```
ast { operation: "scope", filePath: "src/parser.ts", line: 15 }

Line 15 is inside:
  process (function, lines 13-18)
    if block (lines 14-16)
```

Both outline and deps skip test-scoped symbols by default — set `includeTests: true` to include them.

## Install

Requires OpenCode **2.0.29 or newer**. This version uses the V2 plugin API and does not support OpenCode V1.

Build and copy to the global plugins directory:

```sh
bun install
bun run bundle
mkdir -p ~/.config/opencode/plugins
cp dist/ast.js ~/.config/opencode/plugins/ast.js
```

OpenCode auto-loads `.js` files from `~/.config/opencode/plugins/`.

For per-project use, put the bundle in `.opencode/plugins/ast.js`; OpenCode discovers it automatically, with no config entry needed. For a bundle elsewhere, use the native V2 config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./dist/ast.js"]
}
```

The bundle imports `@opencode/plugin` from the host; the bundled tree-sitter library and pinned runtime WASM are version-matched.

## Grammars

WASM grammar files are fetched from tree-sitter GitHub releases on first use and cached in `~/.cache/opencode-ast/`.

Behavior details:

- Downloads use a 15s timeout and up to 3 attempts for transient failures.
- In-flight downloads are deduplicated per process to avoid duplicate fetches.
- Runtime and grammar WASM files are pinned with SHA-256 checksums.
- Downloaded and cached WASM files are checksum-verified before load; mismatches fail closed.
- Query objects are cached with an LRU cap of 100 entries per language.
- Source parsing is limited to 8 MiB per file by default.
  Override with `OPENCODE_AST_MAX_SOURCE_BYTES=<bytes>`.
- `.h` files are auto-routed to C or C++ grammar based on lightweight syntax heuristics.

When upgrading grammar/runtime URLs, refresh checksums:

```sh
bun run update:wasm-manifest
```

Optional flags:

- Bump all selected WASM URLs to latest before hashing:

```sh
bun run update:wasm-manifest -- --bump-latest
```

- Bump/hash only one target (`runtime` or one grammar id such as `typescript`):

```sh
bun run update:wasm-manifest -- --only typescript
bun run update:wasm-manifest -- --bump-latest --only runtime
```

## Safety

- `filePath` can resolve outside the active workspace/worktree.
  Relative paths resolve from the executing session's directory.
- OpenCode's V2 `ast`, `external_directory`, and `read` permissions are checked before reading files; denials stop execution.
- Cancellation is checked between permission waits and parsing. The Promise plugin permission API cannot cancel a pending approval, and shared grammar downloads are not interrupted.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun test
bunx tsc --noEmit
bun run bundle.ts
```
