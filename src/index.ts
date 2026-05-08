import path from "node:path"
import { realpath } from "node:fs/promises"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { Effect } from "effect"
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

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  !!value && typeof (value as PromiseLike<unknown>).then === "function"

const runAsk = async (value: unknown) => {
  if (isPromiseLike(value)) {
    await value
    return
  }
  await Effect.runPromise(value as Effect.Effect<void>)
}

const plugin: Plugin = async () => {
  return {
    tool: {
      ast: tool({
        description: `Analyze source code structure using AST parsing. Supports 14 languages/formats: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, C#, JSON, JSONC, YAML, Markdown.

Prefer outline + extract over reading entire large files. Prefer scope over reading surrounding context manually after grep results.

Operations:
- outline: Get a structural overview of a file (functions, classes, types, keys with line ranges). Use this BEFORE reading large files to understand their structure and then read only the parts you need. Use optional \`filter\` (comma-separated kinds like "struct,trait,enum") to limit output to specific symbol kinds. Valid kinds: ${validKinds.join(", ")}. On files with many symbols, set \`filter\` to avoid noisy output. IMPORTANT: For files over ~200 lines, you MUST use outline before reading the full file — get the structure first, then extract only what you need. For small files (<200 lines), Read is fine.
- extract: Extract the source of a specific symbol by name and optional kind. Returns line-numbered source. Use this when you know the symbol name and want to read a single function or class without reading the entire file. Use kind to disambiguate when a file has both a function and type with the same name. Use optional \`signature\` (boolean) to return only the function/method signature instead of the full body — prefer this first to check types before pulling full implementations. \`kind\` uses the same values as outline/filter.
- deps: List all imports/dependencies of a file, distinguishing local vs external imports. Useful for understanding a file's dependency graph before refactoring. Avoid on large files unless you need the full import graph — for a single import, grep is cheaper.
- scope: Given a line number, show the full enclosing scope chain (not just the immediate parent — the entire nesting from outermost to innermost). Useful when landing on a line from grep results to understand the surrounding context. Very compact output (~5 lines) — ALWAYS prefer this over reading a wide range of lines when you just need to know what surrounds a line.
- outline and deps skip test-scoped symbols by default. Set \`includeTests\` to true to include them.`,
        args: {
          operation: tool.schema.enum(["outline", "extract", "deps", "scope"]),
          filePath: tool.schema.string().describe("Path to source file"),
          name: tool.schema.string().optional(),
          kind: tool.schema.string().optional(),
          filter: tool.schema.string().optional(),
          includeTests: tool.schema.boolean().optional(),
          signature: tool.schema.boolean().optional(),
          line: tool.schema.number().int().positive().optional(),
        },
        async execute(args, ctx) {
          const line = args.line
          if (args.operation === "scope" && line === undefined) {
            return "`line` is required for `scope`"
          }
          if (args.operation === "extract" && !args.kind && !args.name) {
            return "Provide `name` or `kind` to extract a symbol"
          }
          const resolved = await resolveWorkspaceFile(
            args.filePath,
            ctx.directory,
            ctx.worktree,
          )
          const file = resolved.file
          const rel = resolved.rel

          if (await isExternalPath(file, ctx.directory, ctx.worktree)) {
            const parentDir = path.dirname(file)
            const glob = path.join(parentDir, "*").replaceAll("\\", "/")
            await runAsk(
              ctx.ask({
                permission: "external_directory",
                patterns: [glob],
                always: [glob],
                metadata: {
                  filepath: file,
                  parentDir,
                },
              }),
            )
          }

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
          ctx.metadata({
            title: `${op} ${rel}${detail ? ` (${detail})` : ""}`,
          })
          const out = await parse(file)
          try {
            switch (args.operation) {
              case "outline":
                return outline(
                  out.tree,
                  out.lang,
                  args.filter,
                  args.includeTests,
                )
              case "extract":
                return extract(
                  out.tree,
                  out.src,
                  out.lang,
                  args.kind,
                  args.name,
                  args.signature,
                )
              case "deps":
                return deps(out.tree, out.lang, args.includeTests)
              case "scope":
                return scope(out.tree, out.lang, line!)
            }
          } finally {
            out.tree.delete()
          }
        },
      }),
    },
  }
}

export default plugin
