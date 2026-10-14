import path from "node:path"
import { realpath } from "node:fs/promises"
import { Plugin } from "@opencode/plugin"
import { deps } from "./deps"
import { extract } from "./extract"
import { outline } from "./outline"
import { parse } from "./parser"
import { scope } from "./scope"
import { validKinds } from "./util"
import { resolveWorkspaceFile } from "./workspace"

const isInside = (base: string, target: string) => {
  const rel = path.relative(base, target)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/** Canonicalize workspace roots so symlinked external paths still require approval. */
const isExternalPath = async (
  file: string,
  directory: string,
  worktree: string,
) => {
  const dirRoot = await realpath(directory).catch(() => path.resolve(directory))
  const worktreeRoot = await realpath(worktree).catch(() =>
    path.resolve(worktree),
  )
  if (isInside(dirRoot, file)) return false
  if (worktreeRoot === "/") return true
  return !isInside(worktreeRoot, file)
}

/** Input mirrored by the JSON Schema published to OpenCode V2. */
type AstInput = {
  operation: "outline" | "extract" | "deps" | "scope"
  filePath: string
  name?: string
  kind?: string
  filter?: string
  includeTests?: boolean
  signature?: boolean
  line?: number
}

const plugin = Plugin.define({
  id: "opencode-ast",
  /** Register a replayable tool transform; file IO happens only during execution. */
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "ast",
        description: `Analyze source code structure using AST parsing. Supports 14 languages/formats: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, C#, JSON, JSONC, YAML, Markdown.

Prefer outline + extract over reading entire large files. Prefer scope over reading surrounding context manually after grep results.

Operations:
- outline: Get a structural overview of a file (functions, classes, types, keys with line ranges). Use this BEFORE reading large files to understand their structure and then read only the parts you need. Use optional \`filter\` (comma-separated kinds like "struct,trait,enum") to limit output to specific symbol kinds. Valid kinds: ${validKinds.join(", ")}. On files with many symbols, set \`filter\` to avoid noisy output. IMPORTANT: For files over ~200 lines, you MUST use outline before reading the full file — get the structure first, then extract only what you need. For small files (<200 lines), Read is fine.
- extract: Extract the source of a specific symbol by name and optional kind. Returns line-numbered source. Use this when you know the symbol name and want to read a single function or class without reading the entire file. Use kind to disambiguate when a file has both a function and type with the same name. Use optional \`signature\` (boolean) to return only the function/method signature instead of the full body — prefer this first to check types before pulling full implementations. \`kind\` uses the same values as outline/filter.
- deps: List all imports/dependencies of a file, distinguishing local vs external imports. Useful for understanding a file's dependency graph before refactoring. Avoid on large files unless you need the full import graph — for a single import, grep is cheaper.
- scope: Given a line number, show the full enclosing scope chain (not just the immediate parent — the entire nesting from outermost to innermost). Useful when landing on a line from grep results to understand the surrounding context. Very compact output (~5 lines) — ALWAYS prefer this over reading a wide range of lines when you just need to know what surrounds a line.
- outline and deps skip test-scoped symbols by default. Set \`includeTests\` to true to include them.`,
        // Plain JSON Schema keeps the public tool contract independent of schema libraries.
        input: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["outline", "extract", "deps", "scope"],
            },
            filePath: {
              type: "string",
              description: "Path to source file, absolute or session-relative",
            },
            name: { type: "string" },
            kind: { type: "string" },
            filter: { type: "string" },
            includeTests: { type: "boolean" },
            signature: { type: "boolean" },
            line: { type: "integer", minimum: 1 },
          },
          required: ["operation", "filePath"],
          additionalProperties: false,
        },
        /** Resolve the executing session's paths and authorize reads before parsing. */
        async execute(input, context) {
          const args = input as AstInput
          const line = args.line
          if (args.operation === "scope" && line === undefined) {
            return { content: "`line` is required for `scope`" }
          }
          if (args.operation === "extract" && !args.kind && !args.name) {
            return { content: "Provide `name` or `kind` to extract a symbol" }
          }
          context.signal.throwIfAborted()
          const session = await ctx.session.get(
            { sessionID: context.sessionID },
            { signal: context.signal },
          )
          const directory = session.location.directory
          // The active worktree is distinct from the project's canonical checkout.
          const worktree = ctx.location.project.directory
          const resolved = await resolveWorkspaceFile(
            args.filePath,
            directory,
            worktree,
          )
          const file = resolved.file
          const rel = resolved.rel

          const external = await isExternalPath(file, directory, worktree)
          const permissionContext = {
            sessionID: context.sessionID,
            agent: context.agent,
            source: {
              type: "tool" as const,
              messageID: context.messageID,
              id: context.id,
            },
          }
          if (external) {
            const parentDir = path.dirname(file)
            const glob = path.join(parentDir, "*").replaceAll("\\", "/")
            await ctx.permission.assert({
              ...permissionContext,
              action: "external_directory",
              resources: [glob],
              save: [glob],
              metadata: { filepath: file, parentDir },
            })
          }
          const resource = (external ? file : path.relative(directory, file))
            .replaceAll("\\", "/")
          await ctx.permission.assert({
            ...permissionContext,
            action: "read",
            resources: [resource],
            save: [resource],
            metadata: { filepath: file },
          })
          context.signal.throwIfAborted()

          const op = {
            outline: "Outline",
            extract: "Extract",
            deps: "Deps",
            scope: "Scope",
          }[args.operation]
          const detail =
            args.operation === "extract"
              ? args.name || args.kind || ""
              : args.operation === "scope"
                ? `line ${line}`
                : args.filter || ""
          const title = `${op} ${rel}${detail ? ` (${detail})` : ""}`
          await context.progress({ title })
          const out = await parse(file)
          try {
            context.signal.throwIfAborted()
            let content: string
            switch (args.operation) {
              case "outline":
                content = outline(
                  out.tree,
                  out.lang,
                  args.filter,
                  args.includeTests,
                )
                break
              case "extract":
                content = extract(
                  out.tree,
                  out.src,
                  out.lang,
                  args.kind,
                  args.name,
                  args.signature,
                )
                break
              case "deps":
                content = deps(out.tree, out.lang, args.includeTests)
                break
              case "scope":
                content = scope(out.tree, out.lang, line!)
                break
            }
            return { content, metadata: { title } }
          } finally {
            out.tree.delete()
          }
        },
      })
    })
  },
})

export default plugin
