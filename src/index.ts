#!/usr/bin/env bun

import path from "node:path"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMcpServer } from "./server"

export const workspaceRootFromArgs = (
  args: string[],
  cwd = process.cwd(),
): string => {
  const rootIndex = args.indexOf("--root")
  if (rootIndex === -1) return path.resolve(cwd)
  const value = args[rootIndex + 1]
  if (!value || value.startsWith("--")) {
    throw new Error("--root requires a directory path")
  }
  return path.resolve(cwd, value)
}

export const main = async (args = process.argv.slice(2)) => {
  const root = workspaceRootFromArgs(args)
  const server = createMcpServer(root)
  await server.connect(new StdioServerTransport())
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
