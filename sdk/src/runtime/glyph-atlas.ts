export const GLYPH_ATLAS_PAGE_RESERVE = 4

export function glyphAtlasResetPageThreshold(maximumPages: number) {
  if (!Number.isInteger(maximumPages) || maximumPages < 1) {
    throw new RangeError('Glyph atlas maximum page count must be a positive integer.')
  }

  return maximumPages > GLYPH_ATLAS_PAGE_RESERVE
    ? maximumPages - GLYPH_ATLAS_PAGE_RESERVE
    : maximumPages
}
