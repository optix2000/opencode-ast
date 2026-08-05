import path from "node:path"
import { realpath } from "node:fs/promises"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import * as z from "zod/v4"
import { deps } from "./deps"
import { extract } from "./extract"
import { outline } from "./outline"
import { parse } from "./parser"
import { scope } from "./scope"

const toolDescription = `Analyze source code structure with tree-sitter.

Operations:
- outline: list symbols and line ranges; optionally filter by comma-separated kinds.
- extract: return a symbol's line-numbered source or signature.
- deps: list local and external imports.
- scope: show the enclosing scope chain for a line.

Prefer outline followed by extract over reading entire large files.`

export const createMcpServer = (root = process.cwd()) => {
  const workspaceRoot = path.resolve(root)
  const server = new McpServer({ name: "opencode-ast", version: "0.3.0" })

  server.registerTool(
    "ast",
    {
      title: "AST code analysis",
      description: toolDescription,
      inputSchema: z.discriminatedUnion("operation", [
        z.object({
          operation: z.literal("outline"),
          filePath: z.string().describe("Path relative to the workspace root"),
          filter: z.string().optional(),
          includeTests: z.boolean().optional(),
        }),
        z.object({
          operation: z.literal("extract"),
          filePath: z.string().describe("Path relative to the workspace root"),
          name: z.string().optional(),
          kind: z.string().optional(),
          signature: z.boolean().optional(),
        }),
        z.object({
          operation: z.literal("deps"),
          filePath: z.string().describe("Path relative to the workspace root"),
          includeTests: z.boolean().optional(),
        }),
        z.object({
          operation: z.literal("scope"),
          filePath: z.string().describe("Path relative to the workspace root"),
          line: z.number().int().positive(),
        }),
      ]),
    },
    async (args) => {
      const { filePath } = args
      const rootPath = await realpath(workspaceRoot).catch(() => workspaceRoot)
      const input = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(rootPath, filePath)
      const file = await realpath(input).catch(() => input)
      const relative = path.relative(rootPath, file)
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error(`file is outside workspace root: ${filePath}`)
      }
      const out = await parse(file)
      try {
        let text: string
        switch (args.operation) {
          case "outline":
            text = outline(out.tree, out.lang, args.filter, args.includeTests)
            break
          case "extract":
            text = extract(
              out.tree,
              out.src,
              out.lang,
              args.kind,
              args.name,
              args.signature,
            )
            break
          case "deps":
            text = deps(out.tree, out.lang, args.includeTests)
            break
          case "scope":
            text = scope(out.tree, out.lang, args.line)
            break
        }
        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        }
      } finally {
        out.tree.delete()
      }
    },
  )

  return server
}
