export function exportedStart(a: string): string {
  if (a.length > 0) {
    return a
  }
  return ""
}

export function multiline(input: string, other: number): string {
  return input + String(other)
}

export class Container {
  method(value: string): string {
    return value
  }
}
