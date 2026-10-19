import path from "node:path"
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool"
import plugin from "../src/index"

type PermissionInput = Parameters<Plugin.Context["permission"]["assert"]>[0]

/** Host inputs kept separate from the full OpenCode context required by setup. */
type HostOptions = {
  directory?: string
  worktree?: string
  canonical?: string
  assert?: (input: PermissionInput) => Promise<void>
  progress?: () => void
  signal?: AbortSignal
}

/** Minimal V2 host: record registrations, permission checks, and progress updates. */
const harness = async (options: HostOptions = {}) => {
  const tools: Info[] = []
  const permissions: PermissionInput[] = []
  const progress: Record<string, unknown>[] = []
  const transforms: Array<(editor: ToolEditor) => void> = []
  const context = {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "build",
    id: "call_test",
    signal: options.signal ?? new AbortController().signal,
    async progress(update) {
      progress.push(update)
      options.progress?.()
    },
  } as ToolContext
  const editor = {
    add(tool: Info) {
      tools.push(tool)
    },
  } as ToolEditor
  await plugin.setup({
    location: {
      directory: process.cwd(),
      project: {
        directory: options.worktree ?? process.cwd(),
        canonical: options.canonical ?? process.cwd(),
      },
    },
    session: {
      async get(input: { sessionID: string }, request: { signal: AbortSignal }) {
        expect(input.sessionID).toBe(context.sessionID)
        expect(request.signal).toBe(context.signal)
        return { location: { directory: options.directory ?? import.meta.dir } }
      },
    },
    tool: {
      async transform(callback: (editor: ToolEditor) => void) {
        transforms.push(callback)
        callback(editor)
      },
    },
    permission: {
      async assert(input: PermissionInput) {
        permissions.push(input)
        await options.assert?.(input)
      },
    },
  } as unknown as Plugin.Context)
  return {
    tool: tools[0]!, tools, permissions, progress, transforms, editor, context,
  }
}

/** Keep temporary fixtures inside OpenCode's approved temporary directory. */
const tempDirectory = async () => {
  const root = path.join(tmpdir(), "opencode")
  await mkdir(root, { recursive: true })
  return mkdtemp(path.join(root, "ast-v2-"))
}

describe("OpenCode V2 plugin", () => {
  test("defines a stable ID and a replayable JSON Schema tool", async () => {
    const host = await harness()
    expect(plugin.id).toBe("opencode-ast")
    expect(host.tool.name).toBe("ast")
    expect(host.tool.input).toMatchObject({
      type: "object",
      required: ["operation", "filePath"],
      additionalProperties: false,
      properties: {
        operation: { enum: ["outline", "extract", "deps", "scope"] },
        line: { type: "integer", minimum: 1 },
      },
    })
    expect(host.permissions).toHaveLength(0)
    host.transforms[0]!(host.editor)
    expect(host.tools).toHaveLength(2)
    expect(host.tools[1]!.name).toBe("ast")
    expect(host.permissions).toHaveLength(0)
  })

  test.each([
    { operation: "outline", expected: "process (lines 13-18, exported)" },
    { operation: "extract", name: "process", expected: "export function process" },
    { operation: "deps", expected: "zod" },
    { operation: "scope", line: 15, expected: "process" },
  ])("returns structured content for $operation", async ({ expected, ...input }) => {
    const host = await harness()
    const result = await host.tool.execute(
      { ...input, filePath: "fixtures/example.ts" }, host.context,
    )
    expect(result.content).toContain(expected)
    expect(result.metadata?.title).toContain("test/fixtures/example.ts")
    expect(host.progress).toEqual([result.metadata!])
    expect(host.permissions.map((input) => input.action)).toEqual(["ast", "read"])
    expect(host.permissions[1]!.resources).toEqual(["fixtures/example.ts"])
  })

  test("forwards filter and signature options", async () => {
    const host = await harness()
    const filtered = await host.tool.execute({
      operation: "outline",
      filePath: "fixtures/example.ts",
      filter: "interface",
    }, host.context)
    expect(filtered.content).toContain("Config")
    expect(filtered.content).not.toContain("process")
    const signature = await host.tool.execute({
      operation: "extract",
      filePath: "fixtures/example.ts",
      name: "process",
      signature: true,
    }, host.context)
    expect(signature.content).toContain("export function process")
    expect(signature.content).not.toContain("return")
  })

  test.each([
    { operation: "scope", expected: "`line` is required for `scope`" },
    { operation: "extract", expected: "Provide `name` or `kind` to extract a symbol" },
  ])("preserves validation for $operation", async ({ expected, ...input }) => {
    const host = await harness()
    const result = await host.tool.execute(
      { ...input, filePath: "fixtures/example.ts" }, host.context,
    )
    expect(result).toEqual({ content: expected })
    expect(host.permissions).toHaveLength(0)
  })

  test("allows sibling paths inside the active worktree", async () => {
    const host = await harness()
    const result = await host.tool.execute(
      { operation: "outline", filePath: "../src/workspace.ts" }, host.context,
    )
    expect(result.content).toContain("resolveWorkspaceFile")
    expect(host.permissions.map((input) => input.action)).toEqual(["ast", "read"])
    expect(host.permissions[1]!.resources).toEqual(["../src/workspace.ts"])
  })

  test("checks external-directory approval before the canonical file read", async () => {
    const directory = await tempDirectory()
    try {
      const file = path.join(directory, "external.json")
      await Bun.write(file, '{"x":1}\n')
      const host = await harness()
      await host.tool.execute(
        { operation: "outline", filePath: file }, host.context,
      )
      const canonical = await realpath(file)
      const glob = path.join(path.dirname(canonical), "*")
      expect(host.permissions.map((input) => input.action)).toEqual([
        "ast", "external_directory", "read",
      ])
      expect(host.permissions[1]).toMatchObject({
        sessionID: host.context.sessionID,
        agent: host.context.agent,
        resources: [glob],
        save: [glob],
        source: {
          type: "tool", messageID: host.context.messageID, id: host.context.id,
        },
      })
      expect(host.permissions[2]!.resources).toEqual([canonical])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test.each(["ast", "external_directory", "read"])("propagates %s denials without parsing", async (action) => {
    const directory = await tempDirectory()
    try {
      const denied = new Error(`denied ${action}`)
      const host = await harness({
        async assert(input) {
          if (input.action === action) throw denied
        },
      })
      // A nonexistent file would fail parsing if permission denial were swallowed.
      await expect(host.tool.execute({
        operation: "outline",
        filePath: path.join(directory, "missing.json"),
      }, host.context)).rejects.toBe(denied)
      expect(host.progress).toHaveLength(0)
      expect(host.permissions).toHaveLength(["ast", "external_directory", "read"].indexOf(action) + 1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("does not treat a canonical checkout or filesystem root as the active worktree", async () => {
    const directory = await tempDirectory()
    try {
      for (const worktree of [directory, path.parse(directory).root]) {
        const host = await harness({
          directory, worktree, canonical: process.cwd(),
        })
        await host.tool.execute({
          operation: "outline",
          filePath: path.join(import.meta.dir, "fixtures/example.ts"),
        }, host.context)
        expect(host.permissions[1]!.action).toBe("external_directory")
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("requires approval for symlinks escaping the workspace", async () => {
    const directory = await tempDirectory()
    const link = path.join(
      import.meta.dir, `external-${path.basename(directory)}.json`,
    )
    try {
      const file = path.join(directory, "external.json")
      await Bun.write(file, '{"x":1}\n')
      await symlink(file, link)
      const host = await harness()
      await host.tool.execute(
        { operation: "outline", filePath: link }, host.context,
      )
      expect(host.permissions[1]!.action).toBe("external_directory")
      expect(host.permissions[2]!.resources).toEqual([await realpath(file)])
    } finally {
      await rm(link, { force: true })
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("matches read rules relative to a symlinked session directory", async () => {
    const directory = await tempDirectory()
    try {
      const actual = path.join(directory, "actual")
      const linked = path.join(directory, "linked")
      await mkdir(actual)
      await Bun.write(path.join(actual, "secret.json"), '{"secret":true}\n')
      await symlink(actual, linked)
      const denied = new Error("secret read denied")
      const host = await harness({
        directory: linked, worktree: linked,
        async assert(input) {
          if (input.action === "read" && input.resources.includes("secret.json")) throw denied
        },
      })
      await expect(host.tool.execute({
        operation: "outline", filePath: "secret.json",
      }, host.context)).rejects.toBe(denied)
      expect(host.permissions.map((input) => input.action)).toEqual(["ast", "read"])
      expect(host.progress).toHaveLength(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("honors cancellation before file access", async () => {
    const host = await harness({ signal: AbortSignal.abort() })
    await expect(host.tool.execute(
      { operation: "outline", filePath: "fixtures/example.ts" }, host.context,
    )).rejects.toThrow()
    expect(host.permissions).toHaveLength(0)
    expect(host.progress).toHaveLength(0)
  })

  test.each(["approve", "reject"])("waits for external-directory %s before reading", async (reply) => {
    const directory = await tempDirectory()
    // Separate notification and reply gates make the pending approval observable without timers.
    const entered = Promise.withResolvers<void>()
    const approval = Promise.withResolvers<void>()
    try {
      const file = path.join(directory, "external.json")
      await Bun.write(file, '{"x":1}\n')
      const host = await harness({
        async assert(input) {
          if (input.action !== "external_directory") return
          entered.resolve()
          await approval.promise
        },
      })
      const pending = host.tool.execute({ operation: "outline", filePath: file }, host.context)
      await entered.promise
      expect(host.permissions.map((input) => input.action)).toEqual(["ast", "external_directory"])
      expect(host.progress).toHaveLength(0)
      if (reply === "reject") {
        const denied = new Error("approval rejected")
        approval.reject(denied)
        await expect(pending).rejects.toBe(denied)
        expect(host.permissions).toHaveLength(2)
        expect(host.progress).toHaveLength(0)
        return
      }
      approval.resolve()
      expect((await pending).content).toContain("x")
      expect(host.permissions.map((input) => input.action)).toEqual(["ast", "external_directory", "read"])
    } finally {
      approval.resolve()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("does not retain the original worktree boundary after a session move", async () => {
    const directory = await tempDirectory()
    try {
      const host = await harness({ directory })
      await host.tool.execute({
        operation: "outline",
        filePath: path.join(import.meta.dir, "fixtures/example.ts"),
      }, host.context)
      expect(host.permissions.map((input) => input.action)).toEqual(["ast", "external_directory", "read"])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test.each(["ast", "external_directory", "read"])("stops after a cancelled %s approval wait", async (action) => {
    const directory = await tempDirectory()
    const controller = new AbortController()
    const entered = Promise.withResolvers<void>()
    const approval = Promise.withResolvers<void>()
    try {
      const host = await harness({
        signal: controller.signal,
        async assert(input) {
          if (input.action !== action) return
          entered.resolve()
          await approval.promise
        },
      })
      const pending = host.tool.execute({
        operation: "outline", filePath: path.join(directory, "missing.json"),
      }, host.context)
      await entered.promise
      const reason = new Error("session interrupted")
      controller.abort(reason)
      approval.resolve()
      await expect(pending).rejects.toBe(reason)
      expect(host.permissions).toHaveLength(["ast", "external_directory", "read"].indexOf(action) + 1)
      expect(host.progress).toHaveLength(0)
    } finally {
      approval.resolve()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("stops before parsing when progress is cancelled", async () => {
    const controller = new AbortController()
    const reason = new Error("session interrupted during progress")
    const host = await harness({
      signal: controller.signal,
      progress: () => controller.abort(reason),
    })
    await expect(host.tool.execute({
      operation: "outline", filePath: "fixtures/missing.json",
    }, host.context)).rejects.toBe(reason)
  })
})
