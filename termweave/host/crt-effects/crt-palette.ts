export type Rgb = readonly [red: number, green: number, blue: number]

const threeBitLookup = Uint8Array.from({ length: 256 }, (_, value) =>
  Math.round((Math.round((value * 7) / 255) * 255) / 7),
)
const twoBitLookup = Uint8Array.from({ length: 256 }, (_, value) =>
  Math.round((Math.round((value * 3) / 255) * 255) / 3),
)

/** Reduces opaque image bytes to the exact 256-color RGB332 cube. */
export function applyCrtPalette(data: Uint8Array) {
  if (data.byteLength % 4 !== 0) {
    throw new Error('CRT palette input must contain complete RGBA pixels.')
  }

  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = threeBitLookup[data[offset]!]!
    data[offset + 1] = threeBitLookup[data[offset + 1]!]!
    data[offset + 2] = twoBitLookup[data[offset + 2]!]!
  }
}
