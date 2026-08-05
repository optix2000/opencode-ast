# opencode-ast

A local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for tree-sitter-powered source-code analysis. It exposes structural outline, symbol extraction, dependency, and scope queries without requiring a language server.

Tree-sitter is error-tolerant, so the tools continue to work on partially edited or syntactically broken files.

## Supported languages

TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, C#, JSON, JSONC, YAML, Terraform, and Markdown.

## MCP tool

The server exposes one `ast` tool with four operations:

- `outline` — list functions, classes, types, and other symbols with line ranges.
- `extract` — return one symbol's line-numbered source, or only its signature.
- `deps` — list imports and classify them as local or external.
- `scope` — show the enclosing scope chain for a line.

Example arguments:

```json
{ "operation": "outline", "filePath": "src/parser.ts" }
```

```json
{
  "operation": "extract",
  "filePath": "src/parser.ts",
  "name": "parse",
  "kind": "function",
  "signature": true
}
```

```json
{ "operation": "deps", "filePath": "src/parser.ts" }
```

```json
{ "operation": "scope", "filePath": "src/parser.ts", "line": 15 }
```

`outline` accepts an optional comma-separated `filter`, such as `"struct,trait,enum"`. `outline` and `deps` skip test-scoped symbols by default; pass `includeTests: true` to include them.

## Install and configure

[Bun](https://bun.sh/) is required.

Add the server to any stdio-compatible MCP client. Use an absolute workspace path so relative `filePath` values resolve predictably:

```json
{
  "mcpServers": {
    "opencode-ast": {
      "command": "bunx",
      "args": [
        "opencode-ast",
        "--root",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

To run a local checkout instead:

```json
{
  "mcpServers": {
    "opencode-ast": {
      "command": "bun",
      "args": [
        "/absolute/path/to/opencode-ast/src/index.ts",
        "--root",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

When `--root` is omitted, the server uses its current working directory.

## Workspace safety

The server only reads files inside its configured workspace root. Relative or absolute paths that resolve inside the root are accepted; `..` traversal and symlinks that resolve outside the root are rejected.

Source parsing is limited to 8 MiB per file by default. Override the limit with:

```sh
OPENCODE_AST_MAX_SOURCE_BYTES=<bytes>
```

## Grammars

WASM grammar files are downloaded from pinned tree-sitter release URLs on first use and cached in `~/.cache/opencode-ast/`.

- Downloads use a 15-second timeout and up to three attempts for transient failures.
- Runtime and grammar WASM files are pinned with SHA-256 checksums.
- Cached files are checksum-verified before loading; mismatches fail closed.
- In-flight downloads are deduplicated per process.
- Compiled queries use an LRU cache capped at 100 entries per language.
- `.h` files are routed to C or C++ using lightweight syntax heuristics.

Refresh pinned checksums after changing grammar/runtime URLs:

```sh
bun run update:wasm-manifest
```

Optional flags:

```sh
bun run update:wasm-manifest -- --bump-latest
bun run update:wasm-manifest -- --only typescript
bun run update:wasm-manifest -- --bump-latest --only runtime
```

## Development

This repository uses Bun. Dependency installation enforces a 14-day minimum package age through `bunfig.toml`.

```sh
bun install
bun test
bun run typecheck
bun run bundle
```

The production stdio bundle is written to `dist/opencode-ast.js`.
