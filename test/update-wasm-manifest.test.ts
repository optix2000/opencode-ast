import { describe, expect, test } from "bun:test"
import { findLatestAssetUrl, type GithubRelease } from "../update-wasm-manifest"

const release = (
  tag: string,
  options: {
    draft?: boolean
    prerelease?: boolean
    assets: Array<{ name: string; browser_download_url: string }>
  },
): GithubRelease => ({
  draft: options.draft ?? false,
  prerelease: options.prerelease ?? false,
  assets: options.assets,
  tag_name: tag,
})

describe("update-wasm-manifest", () => {
  test("findLatestAssetUrl skips prereleases", () => {
    const releases = [
      release("v2.0.0-rc1", {
        prerelease: true,
        assets: [
          {
            name: "tree-sitter-example.wasm",
            browser_download_url:
              "https://example.com/rc/tree-sitter-example.wasm",
          },
        ],
      }),
      release("v1.9.0", {
        assets: [
          {
            name: "tree-sitter-example.wasm",
            browser_download_url:
              "https://example.com/stable/tree-sitter-example.wasm",
          },
        ],
      }),
    ]

    const found = findLatestAssetUrl(releases, "tree-sitter-example.wasm")
    expect(found).toBe("https://example.com/stable/tree-sitter-example.wasm")
  })

  test("findLatestAssetUrl returns undefined when only prereleases match", () => {
    const releases = [
      release("v2.0.0-beta", {
        prerelease: true,
        assets: [
          {
            name: "tree-sitter-example.wasm",
            browser_download_url:
              "https://example.com/beta/tree-sitter-example.wasm",
          },
        ],
      }),
    ]

    const found = findLatestAssetUrl(releases, "tree-sitter-example.wasm")
    expect(found).toBeUndefined()
  })
})
