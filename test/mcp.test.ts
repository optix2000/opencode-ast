import path from "node:path"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { createMcpServer } from "../src/server"

const root = path.join(import.meta.dir, "..")
const clients: Client[] = []
const servers: McpServer[] = []

const connect = async (workspaceRoot = root) => {
  const server = createMcpServer(workspaceRoot)
  const client = new Client({ name: "opencode-ast-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  clients.push(client)
  servers.push(server)
  return client
}

const textContent = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe("MCP server", () => {
  test("registers the ast tool and runs outline requests", async () => {
    const client = await connect()

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(["ast"])

    const result = await client.callTool({
      name: "ast",
      arguments: {
        operation: "outline",
        filePath: "test/fixtures/example.ts",
      },
    })

    expect(result.isError).not.toBe(true)
    expect(textContent(result)).toContain("process (lines 13-18, exported)")
  })

  test("runs extract requests", async () => {
    const client = await connect()

    const result = await client.callTool({
      name: "ast",
      arguments: {
        operation: "extract",
        filePath: "test/fixtures/example.ts",
        name: "process",
        kind: "function",
      },
    })

    expect(result.isError).not.toBe(true)
    expect(textContent(result)).toContain(
      "13: export function process(input: string): Config {",
    )
  })

  test("runs dependency requests", async () => {
    const client = await connect()

    const result = await client.callTool({
      name: "ast",
      arguments: {
        operation: "deps",
        filePath: "test/fixtures/example.ts",
      },
    })

    expect(result.isError).not.toBe(true)
    expect(textContent(result)).toContain("./foo")
  })

  test("runs scope requests", async () => {
    const client = await connect()

    const result = await client.callTool({
      name: "ast",
      arguments: {
        operation: "scope",
        filePath: "test/fixtures/example.ts",
        line: 15,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(textContent(result)).toContain("process (function, lines 13-18)")
  })

  test("rejects files outside the configured workspace root", async () => {
    const client = await connect()
    const dir = await mkdtemp(path.join(tmpdir(), "opencode-ast-mcp-"))
    const external = path.join(dir, "external.ts")
    await Bun.write(external, "export const secret = 1\n")

    try {
      const result = await client.callTool({
        name: "ast",
        arguments: {
          operation: "outline",
          filePath: external,
        },
      })

      expect(result.isError).toBe(true)
      expect(textContent(result)).toContain("outside workspace root")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("rejects parent-directory traversal outside the workspace root", async () => {
    const client = await connect(path.join(root, "test", "fixtures"))

    const result = await client.callTool({
      name: "ast",
      arguments: {
        operation: "outline",
        filePath: "../../src/index.ts",
      },
    })

    expect(result.isError).toBe(true)
    expect(textContent(result)).toContain("outside workspace root")
  })

  test("rejects symlinks that resolve outside the workspace root", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "opencode-ast-root-"))
    const externalDir = await mkdtemp(path.join(tmpdir(), "opencode-ast-external-"))
    const external = path.join(externalDir, "external.ts")
    const link = path.join(workspace, "linked.ts")
    await Bun.write(external, "export const secret = 1\n")
    await symlink(external, link)

    try {
      const client = await connect(workspace)
      const result = await client.callTool({
        name: "ast",
        arguments: {
          operation: "outline",
          filePath: "linked.ts",
        },
      })

      expect(result.isError).toBe(true)
      expect(textContent(result)).toContain("outside workspace root")
    } finally {
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(externalDir, { recursive: true, force: true }),
      ])
    }
  })

  test("serves MCP over stdio from the command-line entrypoint", async () => {
    const client = new Client({ name: "opencode-ast-cli-test", version: "1.0.0" })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "src", "index.ts"), "--root", root],
      stderr: "pipe",
    })
    await client.connect(transport)
    clients.push(client)

    const result = await client.callTool({
      name: "ast",
      arguments: {
        operation: "outline",
        filePath: "test/fixtures/example.ts",
      },
    })

    expect(result.isError).not.toBe(true)
    expect(textContent(result)).toContain("process (lines 13-18, exported)")
  })
})
