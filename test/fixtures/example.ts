import { foo } from "./foo"
import z from "zod"

export interface Config {
  name: string
  value: number
}

export type Result = {
  ok: boolean
}

export function process(input: string): Config {
  if (input.length === 0) {
    return { name: "", value: 0 }
  }
  return { name: input, value: input.length }
}

class Parser {
  private data: string

  constructor(data: string) {
    this.data = data
  }

  parse(): Result {
    return { ok: this.data.length > 0 }
  }
}

export const helper = () => {
  return 42
}

enum Status {
  Active,
  Inactive,
}
