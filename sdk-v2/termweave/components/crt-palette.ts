import type { Rgb } from './image'

const RED_WEIGHT = 54
const GREEN_WEIGHT = 183
const BLUE_WEIGHT = 19

const rgb333Lookup = Uint8Array.from({ length: 256 }, (_, value) =>
  Math.round((Math.round((value * 7) / 255) * 255) / 7),
)

function weightedDistance(red: number, green: number, blue: number, candidate: Rgb) {
  const redDifference = red - candidate[0]
  const greenDifference = green - candidate[1]
  const blueDifference = blue - candidate[2]
  return (
    RED_WEIGHT * redDifference * redDifference +
    GREEN_WEIGHT * greenDifference * greenDifference +
    BLUE_WEIGHT * blueDifference * blueDifference
  )
}

/**
 * Reduces opaque image bytes to a uniform 9-bit RGB cube. The exact component background is an
 * additional palette anchor so transparent and near-transparent image edges remain seamless with
 * the surrounding OpenTUI box.
 */
export function applyCrtPalette(data: Uint8Array, background: Rgb) {
  if (data.byteLength % 4 !== 0) {
    throw new Error('CRT palette input must contain complete RGBA pixels.')
  }

  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset]!
    const green = data[offset + 1]!
    const blue = data[offset + 2]!
    const cube = [rgb333Lookup[red]!, rgb333Lookup[green]!, rgb333Lookup[blue]!] as const

    if (
      weightedDistance(red, green, blue, background) <= weightedDistance(red, green, blue, cube)
    ) {
      data[offset] = background[0]
      data[offset + 1] = background[1]
      data[offset + 2] = background[2]
    } else {
      data[offset] = cube[0]
      data[offset + 1] = cube[1]
      data[offset + 2] = cube[2]
    }
  }
}
