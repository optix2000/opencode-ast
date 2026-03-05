import path from "node:path"
import { realpath } from "node:fs/promises"

export const resolveWorkspaceFile = async (
  filePath: string,
  directory: string,
  worktree: string,
) => {
  const root = path.resolve(worktree)
  const input = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(directory, filePath)
  const file = await realpath(input).catch(() => input)
  return {
    file,
    root,
    rel: path.relative(root, file) || path.basename(file),
  }
}
