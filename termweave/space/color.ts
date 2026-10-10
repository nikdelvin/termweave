export type Rgba = readonly [r: number, g: number, b: number, a: number]

export function rgbaFromHex(hex: string): Rgba {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255, 1]
}

export function colorsFromPackedArray(values: readonly number[]): Rgba[] {
  const colors: Rgba[] = []
  for (let i = 0; i + 3 < values.length; i += 4) {
    colors.push([values[i]!, values[i + 1]!, values[i + 2]!, values[i + 3] ?? 1])
  }
  return colors
}
