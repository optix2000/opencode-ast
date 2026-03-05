import path from "node:path"
import { mkdtemp, realpath, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import { deps } from "../src/deps"
import { extract } from "../src/extract"
import plugin from "../src/index"
import { resolveWorkspaceFile } from "../src/workspace"
import { outline } from "../src/outline"
import {
  __queryCacheLimit,
  __queryCacheSize,
  parse,
  query,
} from "../src/parser"
import { scope } from "../src/scope"

const ts = path.join(import.meta.dir, "fixtures", "example.ts")
const alias = path.join(import.meta.dir, "fixtures", "alias.js")
const jsRequire = path.join(import.meta.dir, "fixtures", "js-require.js")
const jsDepsExtended = path.join(
  import.meta.dir,
  "fixtures",
  "js-deps-extended.js",
)
const jsTestFalsePositive = path.join(
  import.meta.dir,
  "fixtures",
  "js-test-false-positive.js",
)
const tsScopeEdge = path.join(import.meta.dir, "fixtures", "scope-edge.ts")
const tsNamespace = path.join(import.meta.dir, "fixtures", "ts-namespace.ts")
const py = path.join(import.meta.dir, "fixtures", "example.py")
const pyRelative = path.join(import.meta.dir, "fixtures", "python-relative.py")
const pyRelativeWhitespace = path.join(
  import.meta.dir,
  "fixtures",
  "python-relative-whitespace.py",
)
const pyMainGuard = path.join(
  import.meta.dir,
  "fixtures",
  "python-main-guard.py",
)
const go = path.join(import.meta.dir, "fixtures", "example.go")
const goKinds = path.join(import.meta.dir, "fixtures", "go-kinds.go")
const cData = path.join(import.meta.dir, "fixtures", "c-data.c")
const cIncludes = path.join(import.meta.dir, "fixtures", "c-includes.c")
const cIncludesSpacing = path.join(
  import.meta.dir,
  "fixtures",
  "c-includes-spacing.c",
)
const cHeader = path.join(import.meta.dir, "fixtures", "c-header.h")
const cppHeader = path.join(import.meta.dir, "fixtures", "cpp-header.h")
const rustMacros = path.join(import.meta.dir, "fixtures", "rust-macros.rs")
const rustScope = path.join(import.meta.dir, "fixtures", "scope-rust.rs")
const javaPublic = path.join(import.meta.dir, "fixtures", "public.java")
const csharpPublic = path.join(import.meta.dir, "fixtures", "public.cs")
const jsonData = path.join(import.meta.dir, "fixtures", "sample.json")
const jsoncData = path.join(import.meta.dir, "fixtures", "sample.jsonc")
const yamlData = path.join(import.meta.dir, "fixtures", "sample.yaml")
const mdData = path.join(import.meta.dir, "fixtures", "sample.md")
const wasmManifest = path.join(
  import.meta.dir,
  "..",
  "src",
  "wasm-manifest.json",
)

const run = async (
  file: string,
  fn: (tree: Awaited<ReturnType<typeof parse>>["tree"], lang: string) => string,
) => {
  const out = await parse(file)
  const txt = fn(out.tree, out.lang)
  out.tree.delete()
  return txt
}

describe("parser", () => {
  test("parses different languages concurrently without cross-language bleed", async () => {
    for (let i = 0; i < 20; i++) {
      const [one, two] = await Promise.all([parse(ts), parse(py)])
      try {
        expect(one.lang).toBe("typescript")
        expect(one.tree.rootNode.type).toBe("program")
        expect(two.lang).toBe("python")
        expect(two.tree.rootNode.type).toBe("module")
      } finally {
        one.tree.delete()
        two.tree.delete()
      }
    }
  })

  test("rejects files that exceed source-size guardrail", async () => {
    const large = path.join(import.meta.dir, "fixtures", "tmp-too-large.ts")
    const overLimit = "x".repeat(8 * 1024 * 1024 + 1)
    await Bun.write(large, `export const tooLarge = "${overLimit}";\n`)
    try {
      await expect(parse(large)).rejects.toThrow("source file exceeds limit")
    } finally {
      await unlink(large).catch(() => undefined)
    }
  })

  test("evicts older compiled queries with LRU cap", async () => {
    const out = await parse(ts)
    out.tree.delete()
    const prefix = "(function_declaration name: (identifier) @name) @def"
    for (let i = 0; i < __queryCacheLimit + 25; i++) {
      query("typescript", `${prefix}\n; ${i}`)
    }
    expect(__queryCacheSize("typescript")).toBe(__queryCacheLimit)
  })
})

describe("workspace", () => {
  test("resolveWorkspaceFile normalizes absolute and relative inputs", async () => {
    const rel = path.relative(import.meta.dir, ts)
    const absOut = await resolveWorkspaceFile(
      ts,
      import.meta.dir,
      process.cwd(),
    )
    const relOut = await resolveWorkspaceFile(
      rel,
      import.meta.dir,
      process.cwd(),
    )
    expect(absOut.root).toBe(path.resolve(process.cwd()))
    expect(absOut.file).toBe(ts)
    expect(relOut.file).toBe(ts)
    expect(relOut.rel).toBe(absOut.rel)
  })
})

describe("permissions", () => {
  test("ast asks external_directory for paths outside directory/worktree", async () => {
    const hooks = await plugin({} as any)
    const astTool = hooks.tool?.ast
    expect(astTool).toBeDefined()

    const dir = await mkdtemp(path.join(tmpdir(), "opencode-ast-test-"))
    const external = path.join(dir, "external.json")
    await Bun.write(external, '{"x":1}\n')

    const asks: Array<{ permission: string; patterns: string[] }> = []
    try {
      await astTool!.execute(
        {
          operation: "outline",
          filePath: external,
        },
        {
          sessionID: "session_test",
          messageID: "message_test",
          agent: "test",
          directory: import.meta.dir,
          worktree: process.cwd(),
          abort: new AbortController().signal,
          metadata() {},
          async ask(input) {
            asks.push({
              permission: input.permission,
              patterns: input.patterns,
            })
          },
        },
      )

      const externalReq = asks.find(
        (x) => x.permission === "external_directory",
      )
      expect(externalReq).toBeDefined()
      const resolvedDir = await realpath(dir).catch(() => dir)
      expect(externalReq!.patterns[0]).toBe(
        path.join(resolvedDir, "*").split("\\").join("/"),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("ast does not ask external_directory for paths inside workspace", async () => {
    const hooks = await plugin({} as any)
    const astTool = hooks.tool?.ast
    expect(astTool).toBeDefined()

    const asks: Array<{ permission: string; patterns: string[] }> = []
    await astTool!.execute(
      {
        operation: "outline",
        filePath: ts,
      },
      {
        sessionID: "session_test",
        messageID: "message_test",
        agent: "test",
        directory: import.meta.dir,
        worktree: process.cwd(),
        abort: new AbortController().signal,
        metadata() {},
        async ask(input) {
          asks.push({ permission: input.permission, patterns: input.patterns })
        },
      },
    )

    const externalReq = asks.find((x) => x.permission === "external_directory")
    expect(externalReq).toBeUndefined()
  })
})

describe("wasm manifest", () => {
  test("pins checksums for runtime and grammars", async () => {
    const json = (await Bun.file(wasmManifest).json()) as {
      runtime: { sha256: string }
      grammars: { id: string; sha256: string; exts: string[] }[]
    }
    const sha = /^[a-f0-9]{64}$/
    expect(json.runtime.sha256).toMatch(sha)
    expect(json.grammars.length).toBeGreaterThan(0)
    for (const row of json.grammars) {
      expect(row.sha256).toMatch(sha)
      expect(row.exts.length).toBeGreaterThan(0)
    }
  })
})

describe("typescript", () => {
  test("outline includes key symbols", async () => {
    const txt = await run(ts, outline)
    expect(txt).toContain("Config (lines 4-7, exported)")
    expect(txt).toContain("Result (lines 9-11, exported)")
    expect(txt).toContain("process (lines 13-18, exported)")
    expect(txt).toContain("Parser (lines 20-30)")
    expect(txt).toContain("helper (lines 32-34, exported)")
    expect(txt).toContain("Status (lines 36-39)")
  })

  test("outline filters by kinds", async () => {
    const out = await parse(ts)
    const txt = outline(out.tree, out.lang, "interface,type")
    out.tree.delete()
    expect(txt).toContain("Config (lines 4-7, exported)")
    expect(txt).toContain("Result (lines 9-11, exported)")
    expect(txt).not.toContain("process")
    expect(txt).not.toContain("Parser")
  })

  test("outline reports invalid filter kinds", async () => {
    const out = await parse(ts)
    const txt = outline(out.tree, out.lang, "function,banana")
    out.tree.delete()
    expect(txt).toContain("Unknown kind: banana")
    expect(txt).toContain("Valid kinds for this file:")
  })

  test("outline finds namespace declarations", async () => {
    const out = await parse(tsNamespace)
    const txt = outline(out.tree, out.lang, "namespace")
    out.tree.delete()
    expect(txt).toContain("ProviderTransform (lines 1-5, exported)")
  })

  test("extract finds namespace by kind", async () => {
    const out = await parse(tsNamespace)
    const txt = extract(
      out.tree,
      out.src,
      out.lang,
      "namespace",
      "ProviderTransform",
    )
    out.tree.delete()
    expect(txt).toContain("// namespace ProviderTransform (lines 1-5)")
    expect(txt).toContain("1: export namespace ProviderTransform {")
  })

  test("extract returns function source", async () => {
    const out = await parse(ts)
    const txt = extract(out.tree, out.src, out.lang, "function", "process")
    out.tree.delete()
    expect(txt).toContain("// function process (lines 13-18)")
    expect(txt).toContain(
      "13: export function process(input: string): Config {",
    )
    expect(txt).toContain("18: }")
  })

  test("extract returns function signature", async () => {
    const out = await parse(ts)
    const txt = extract(
      out.tree,
      out.src,
      out.lang,
      "function",
      "process",
      true,
    )
    out.tree.delete()
    expect(txt).toContain(
      "13: export function process(input: string): Config {",
    )
    expect(txt).not.toContain("18: }")
  })

  test("extract returns not found", async () => {
    const out = await parse(ts)
    const txt = extract(out.tree, out.src, out.lang, "function", "missing")
    out.tree.delete()
    expect(txt).toContain("Symbol not found")
  })

  test("extract reports invalid kinds", async () => {
    const out = await parse(ts)
    const txt = extract(out.tree, out.src, out.lang, "banana", "process")
    out.tree.delete()
    expect(txt).toContain("Unknown kind: banana")
    expect(txt).toContain("Valid kinds for this file:")
  })

  test("deps lists import sources", async () => {
    const txt = await run(ts, deps)
    expect(txt).toContain("./foo (local, line 1)")
    expect(txt).toContain("zod (external, line 2)")
  })

  test("deps treats @/ alias as local", async () => {
    const txt = await run(alias, deps)
    expect(txt).toContain("@/components/Button (local, line 1)")
    expect(txt).toContain("@scope/pkg (external, line 2)")
  })

  test("scope shows enclosing chain", async () => {
    const out = await parse(ts)
    const txt = scope(out.tree, out.lang, 15)
    out.tree.delete()
    expect(txt).toContain("Line 15 is inside:")
    expect(txt).toContain("process (function, lines 13-18)")
    expect(txt).toContain("if block (lines 14-16)")
  })

  test("scope orders chain from outermost to innermost", async () => {
    const out = await parse(ts)
    const txt = scope(out.tree, out.lang, 15)
    out.tree.delete()
    const processIndex = txt.indexOf("process (function, lines 13-18)")
    const ifIndex = txt.indexOf("if block (lines 14-16)")
    expect(processIndex).toBeGreaterThan(-1)
    expect(ifIndex).toBeGreaterThan(-1)
    expect(processIndex).toBeLessThan(ifIndex)
  })

  test("scope includes function on opening line", async () => {
    const out = await parse(ts)
    const txt = scope(out.tree, out.lang, 13)
    out.tree.delete()
    expect(txt).toContain("Line 13 is inside:")
    expect(txt).toContain("process (function, lines 13-18)")
  })

  test("scope includes arrow function on opening line", async () => {
    const out = await parse(ts)
    const txt = scope(out.tree, out.lang, 32)
    out.tree.delete()
    expect(txt).toContain("Line 32 is inside:")
    expect(txt).toContain("function (lines 32-34)")
  })

  test("scope merges both line-edge chains without duplicates", async () => {
    const out = await parse(ts)
    const txt = scope(out.tree, out.lang, 14)
    out.tree.delete()
    const processCount =
      txt.match(/process \(function, lines 13-18\)/g)?.length ?? 0
    const ifCount = txt.match(/if block \(lines 14-16\)/g)?.length ?? 0
    expect(processCount).toBe(1)
    expect(ifCount).toBe(1)
  })

  test("scope handles multiline signatures and export wrappers", async () => {
    const out = await parse(tsScopeEdge)
    const line1 = scope(out.tree, out.lang, 1)
    const line8 = scope(out.tree, out.lang, 8)
    const line9 = scope(out.tree, out.lang, 9)
    const line11 = scope(out.tree, out.lang, 11)
    const line15 = scope(out.tree, out.lang, 15)
    const line16 = scope(out.tree, out.lang, 16)
    out.tree.delete()

    expect(line1).toContain("exportedStart (function, lines 1-6)")
    expect(line8).toContain("multiline (function, lines 8-13)")
    expect(line9).toContain("multiline (function, lines 8-13)")
    expect(line11).toContain("multiline (function, lines 8-13)")
    expect(line15).toContain("Container (class, lines 15-21)")
    expect(line16).toContain("Container (class, lines 15-21)")
    expect(line16).toContain("method (method, lines 16-20)")
  })
})

describe("javascript", () => {
  test("deps lists require sources", async () => {
    const txt = await run(jsRequire, deps)
    expect(txt).toContain("fs (external, line 1)")
    expect(txt).toContain("path (external, line 2)")
    expect(txt).toContain("./local (local, line 3)")
  })

  test("deps includes re-exports and dynamic imports", async () => {
    const txt = await run(jsDepsExtended, deps)
    expect(txt).toContain("core-js (external, line 1)")
    expect(txt).toContain("node:fs (external, line 2)")
    expect(txt).toContain("./local-reexport (local, line 3)")
    expect(txt).toContain("./lazy (local, line 5)")
    expect(txt).toContain("@scope/dynamic (external, line 6)")
  })

  test("deps avoids false positives for non-test helper calls", async () => {
    const txt = await run(jsTestFalsePositive, deps)
    expect(txt).toContain("./runtime (local, line 1)")
  })
})

describe("python", () => {
  test("outline includes key symbols", async () => {
    const txt = await run(py, outline)
    expect(txt).toContain("Parser (lines 5-10, exported)")
    expect(txt).toContain("process (lines 13-16, exported)")
    expect(txt).toContain("decorated (lines 19-21, exported)")
  })

  test("deps lists import sources", async () => {
    const txt = await run(py, deps)
    expect(txt).toContain("os (external, line 1)")
    expect(txt).toContain("pathlib (external, line 2)")
  })

  test("deps includes relative imports", async () => {
    const txt = await run(pyRelative, deps)
    expect(txt).toContain(". (local, line 1)")
    expect(txt).toContain("..pkg (local, line 2)")
    expect(txt).toContain(".nested (local, line 3)")
    expect(txt).toContain("requests (external, line 4)")
  })

  test("deps handles whitespace-heavy from-import statements", async () => {
    const txt = await run(pyRelativeWhitespace, deps)
    expect(txt).toContain(". (local, line 1)")
    expect(txt).toContain("..pkg (local, line 2)")
    expect(txt).toContain(".nested (local, line 3)")
    expect(txt).toContain("requests (external, line 4)")
  })

  test("deps keeps imports inside __main__ guards", async () => {
    const txt = await run(pyMainGuard, deps)
    expect(txt).toContain("os (external, line 2)")
    expect(txt).toContain("requests (external, line 4)")
  })

  test("scope shows enclosing chain", async () => {
    const out = await parse(py)
    const txt = scope(out.tree, out.lang, 15)
    out.tree.delete()
    expect(txt).toContain("Line 15 is inside:")
    expect(txt).toContain("process (function, lines 13-16)")
    expect(txt).toContain("if block (lines 14-15)")
  })

  test("scope includes function on declaration line", async () => {
    const out = await parse(py)
    const txt = scope(out.tree, out.lang, 13)
    out.tree.delete()
    expect(txt).toContain("Line 13 is inside:")
    expect(txt).toContain("process (function, lines 13-16)")
  })
})

describe("go", () => {
  test("outline includes key symbols", async () => {
    const txt = await run(go, outline)
    expect(txt).toContain("Config (lines 8-11, exported)")
    expect(txt).toContain("Process (lines 13-18, exported)")
    expect(txt).toContain("String (lines 20-22, exported)")
  })

  test("outline filters struct kind", async () => {
    const out = await parse(go)
    const txt = outline(out.tree, out.lang, "struct")
    out.tree.delete()
    expect(txt).toContain("Config (lines 8-11, exported)")
    expect(txt).not.toContain("Process")
  })

  test("extract finds go struct by struct kind", async () => {
    const out = await parse(go)
    const txt = extract(out.tree, out.src, out.lang, "struct", "Config")
    out.tree.delete()
    expect(txt).toContain("// struct Config (lines 8-11)")
    expect(txt).toContain("8: type Config struct {")
  })

  test("go kind detection does not leak from nested body types", async () => {
    const out = await parse(goKinds)
    const methods = outline(out.tree, out.lang, "method")
    const functions = outline(out.tree, out.lang, "function")
    const structs = outline(out.tree, out.lang, "struct")
    const interfaces = outline(out.tree, out.lang, "interface")
    const methodExtract = extract(
      out.tree,
      out.src,
      out.lang,
      "method",
      "InsertReceiptChain",
    )
    const functionExtract = extract(
      out.tree,
      out.src,
      out.lang,
      "function",
      "SetCanonical",
    )
    out.tree.delete()

    expect(methods).toContain("InsertReceiptChain (lines 5-7, exported)")
    expect(functions).toContain("SetCanonical (lines 9-11, exported)")
    expect(structs).toContain("BlockChain (lines 3-3, exported)")
    expect(structs).not.toContain("InsertReceiptChain")
    expect(structs).not.toContain("SetCanonical")
    expect(interfaces).toContain("No symbols found")
    expect(methodExtract).toContain("// method InsertReceiptChain (lines 5-7)")
    expect(functionExtract).toContain("// function SetCanonical (lines 9-11)")
  })

  test("deps lists import sources", async () => {
    const txt = await run(go, deps)
    expect(txt).toContain("fmt (external, line 4)")
    expect(txt).toContain("os (external, line 5)")
  })

  test("scope shows enclosing chain", async () => {
    const out = await parse(go)
    const txt = scope(out.tree, out.lang, 15)
    out.tree.delete()
    expect(txt).toContain("Line 15 is inside:")
    expect(txt).toContain("Process (function, lines 13-18)")
    expect(txt).toContain("if block (lines 14-16)")
  })

  test("scope includes function on declaration line", async () => {
    const out = await parse(go)
    const txt = scope(out.tree, out.lang, 13)
    out.tree.delete()
    expect(txt).toContain("Line 13 is inside:")
    expect(txt).toContain("Process (function, lines 13-18)")
  })
})

describe("rust", () => {
  test("outline finds macro_rules definitions", async () => {
    const out = await parse(rustMacros)
    const txt = outline(out.tree, out.lang, "macro")
    out.tree.delete()
    expect(txt).toContain("delegate_impls_to_as_ref (lines 1-3)")
  })

  test("extract finds macro_rules by macro kind", async () => {
    const out = await parse(rustMacros)
    const txt = extract(
      out.tree,
      out.src,
      out.lang,
      "macro",
      "delegate_impls_to_as_ref",
    )
    out.tree.delete()
    expect(txt).toContain("// macro delegate_impls_to_as_ref (lines 1-3)")
    expect(txt).toContain("1: macro_rules! delegate_impls_to_as_ref {")
  })

  test("outline marks pub declarations as exported", async () => {
    const out = await parse(rustMacros)
    const txt = outline(out.tree, out.lang, "struct")
    out.tree.delete()
    expect(txt).toContain("Holder (lines 5-5, exported)")
  })

  test("scope includes struct on declaration line", async () => {
    const out = await parse(rustScope)
    const txt = scope(out.tree, out.lang, 1)
    out.tree.delete()
    expect(txt).toContain("Line 1 is inside:")
    expect(txt).toContain("Worker (struct, lines 1-3)")
  })

  test("scope includes enum on declaration line", async () => {
    const out = await parse(rustScope)
    const txt = scope(out.tree, out.lang, 5)
    out.tree.delete()
    expect(txt).toContain("Line 5 is inside:")
    expect(txt).toContain("Mode (enum, lines 5-8)")
  })

  test("scope includes impl on declaration line", async () => {
    const out = await parse(rustScope)
    const txt = scope(out.tree, out.lang, 10)
    out.tree.delete()
    expect(txt).toContain("Line 10 is inside:")
    expect(txt).toContain("Worker (impl, lines 10-14)")
  })
})

describe("c", () => {
  test("outline finds initialized data declarations as variables", async () => {
    const out = await parse(cData)
    const txt = outline(out.tree, out.lang, "variable")
    out.tree.delete()
    expect(txt).toContain("secp256k1_pre_g (lines 1-1)")
    expect(txt).toContain("table (lines 2-2)")
    expect(txt).toContain("global_var (lines 3-3)")
  })

  test("deps classifies quoted includes as local", async () => {
    const txt = await run(cIncludes, deps)
    expect(txt).toContain("stdio.h (external, line 1)")
    expect(txt).toContain("local.h (local, line 2)")
    expect(txt).toContain("../relative.h (local, line 3)")
  })

  test("deps handles include directives with odd spacing", async () => {
    const txt = await run(cIncludesSpacing, deps)
    expect(txt).toContain("stdio.h (external, line 1)")
    expect(txt).toContain("local.h (local, line 2)")
    expect(txt).toContain("../relative.h (local, line 3)")
  })

  test("parses plain .h files as c", async () => {
    const out = await parse(cHeader)
    out.tree.delete()
    expect(out.lang).toBe("c")
  })

  test("parses cpp-like .h files as cpp", async () => {
    const out = await parse(cppHeader)
    out.tree.delete()
    expect(out.lang).toBe("cpp")
  })

  test("outline supports cpp headers routed from .h", async () => {
    const txt = await run(cppHeader, outline)
    expect(txt).toContain("Widget")
    expect(txt).toContain("demo")
  })
})

describe("java", () => {
  test("outline marks public declarations as exported", async () => {
    const txt = await run(javaPublic, outline)
    expect(txt).toContain("Internal (lines 1-3)")
    expect(txt).not.toContain("Internal (lines 1-3, exported)")
    expect(txt).toContain("External (lines 5-8, exported)")
    expect(txt).toContain("run (lines 6-7, exported)")
  })
})

describe("csharp", () => {
  test("outline marks public declarations as exported", async () => {
    const txt = await run(csharpPublic, outline)
    expect(txt).toContain("Internal (lines 1-4)")
    expect(txt).not.toContain("Internal (lines 1-4, exported)")
    expect(txt).toContain("External (lines 6-10, exported)")
    expect(txt).toContain("Run (lines 8-9, exported)")
  })
})

describe("json", () => {
  test("outline includes top-level keys", async () => {
    const txt = await run(jsonData, outline)
    expect(txt).toContain("Keys:")
    expect(txt).toContain("name (lines 2-2)")
    expect(txt).toContain("version (lines 3-3)")
    expect(txt).toContain("server (lines 4-7)")
    expect(txt).toContain("items (lines 8-8)")
    expect(txt).not.toContain("host (lines")
  })

  test("extract finds key by name", async () => {
    const out = await parse(jsonData)
    const txt = extract(out.tree, out.src, out.lang, "key", "server")
    out.tree.delete()
    expect(txt).toContain("// key server (lines 4-7)")
    expect(txt).toContain('4:   "server": {')
  })

  test("deps returns no imports", async () => {
    const txt = await run(jsonData, deps)
    expect(txt).toBe("No imports found")
  })

  test("scope shows nested object chain", async () => {
    const out = await parse(jsonData)
    const txt = scope(out.tree, out.lang, 5)
    out.tree.delete()
    expect(txt).toContain("Line 5 is inside:")
    expect(txt).toContain("object (lines 1-9)")
    expect(txt).toContain("object (lines 4-7)")
  })

  test("outline works for jsonc files", async () => {
    const txt = await run(jsoncData, outline)
    expect(txt).toContain("Keys:")
    expect(txt).toContain("name (lines 3-3)")
    expect(txt).toContain("version (lines 4-4)")
    expect(txt).toContain("server (lines 5-8)")
  })
})

describe("yaml", () => {
  test("outline includes top-level keys", async () => {
    const txt = await run(yamlData, outline)
    expect(txt).toContain("Keys:")
    expect(txt).toContain("name (lines 1-1)")
    expect(txt).toContain("version (lines 2-2)")
    expect(txt).toContain("server (lines 3-5)")
    expect(txt).toContain("items (lines 6-9)")
    expect(txt).not.toContain("host (lines")
  })

  test("extract finds key by name", async () => {
    const out = await parse(yamlData)
    const txt = extract(out.tree, out.src, out.lang, "key", "server")
    out.tree.delete()
    expect(txt).toContain("// key server (lines 3-5)")
    expect(txt).toContain("3: server:")
  })

  test("deps returns no imports", async () => {
    const txt = await run(yamlData, deps)
    expect(txt).toBe("No imports found")
  })

  test("scope shows nested mapping chain", async () => {
    const out = await parse(yamlData)
    const txt = scope(out.tree, out.lang, 4)
    out.tree.delete()
    expect(txt).toContain("Line 4 is inside:")
    expect(txt).toContain("mapping (lines 1-9)")
    expect(txt).toContain("mapping (lines 4-5)")
  })
})

describe("markdown", () => {
  test("outline includes headings", async () => {
    const txt = await run(mdData, outline)
    expect(txt).toContain("Headings:")
    expect(txt).toContain("Title")
    expect(txt).toContain("Installation")
    expect(txt).toContain("Usage")
    expect(txt).toContain("Basic")
    expect(txt).toContain("Advanced")
    expect(txt).toContain("API Reference")
  })

  test("extract finds heading section by name", async () => {
    const out = await parse(mdData)
    const txt = extract(out.tree, out.src, out.lang, "heading", "Usage")
    out.tree.delete()
    expect(txt).toContain("// heading Usage")
    expect(txt).toContain("## Usage")
  })

  test("deps returns no imports", async () => {
    const txt = await run(mdData, deps)
    expect(txt).toBe("No imports found")
  })

  test("scope shows enclosing section chain", async () => {
    const out = await parse(mdData)
    const txt = scope(out.tree, out.lang, 12)
    out.tree.delete()
    expect(txt).toContain("Line 12 is inside:")
    expect(txt).toContain("section")
  })
})
