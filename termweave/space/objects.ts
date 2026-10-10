import { colorsFromPackedArray, type Rgba } from './color'
import type { LayerParams } from './object-shaders/layer'

export interface LayerDefaults {
  params: Partial<LayerParams> & { timeSpeed?: number }
  colors: Rgba[]
  darkColors?: Rgba[]
  pixelsRatio?: number
}

const c = colorsFromPackedArray

export const TERRAN_WET_LAND: LayerDefaults = {
  params: {
    seed: 8.98,
    rotation: 0.2,
    lightOrigin: [0.39, 0.39],
    timeSpeed: 0.1,
    ditherSize: 3.951,
    lightBorder1: 0.287,
    lightBorder2: 0.476,
    riverCutoff: 0.368,
    size: 4.6,
    octaves: 6,
  },
  colors: c([
    0.388235, 0.670588, 0.247059, 1, 0.231373, 0.490196, 0.309804, 1, 0.184314, 0.341176,
    0.32549, 1, 0.156863, 0.207843, 0.25098, 1, 0.309804, 0.643137, 0.721569, 1, 0.25098,
    0.286275, 0.45098, 1,
  ]),
}

export const TERRAN_WET_CLOUD: LayerDefaults = {
  params: {
    seed: 5.939,
    rotation: 0,
    cloudCover: 0.47,
    lightOrigin: [0.39, 0.39],
    timeSpeed: 0.1,
    stretch: 2,
    cloudCurve: 1.3,
    lightBorder1: 0.52,
    lightBorder2: 0.62,
    size: 7.315,
    octaves: 2,
  },
  colors: c([
    0.960784, 1, 0.909804, 1, 0.87451, 0.878431, 0.909804, 1, 0.407843, 0.435294, 0.6, 1,
    0.25098, 0.286275, 0.45098, 1,
  ]),
}

export const TERRAN_DRY_LAND: LayerDefaults = {
  params: {
    seed: 1.175,
    rotation: 0,
    lightOrigin: [0.4, 0.3],
    lightDistance1: 0.362,
    lightDistance2: 0.525,
    timeSpeed: 0.1,
    ditherSize: 2,
    size: 8,
    octaves: 3,
    nColors: 5,
  },
  colors: c([
    1, 0.537255, 0.2, 1, 0.901961, 0.270588, 0.223529, 1, 0.678431, 0.184314, 0.270588, 1,
    0.321569, 0.2, 0.247059, 1, 0.239216, 0.160784, 0.211765, 1,
  ]),
}

export const ISLANDS_WATER: LayerDefaults = {
  params: {
    seed: 10.0,
    rotation: 0,
    lightOrigin: [0.39, 0.39],
    timeSpeed: 0.1,
    ditherSize: 2,
    lightBorder1: 0.4,
    lightBorder2: 0.6,
    size: 5.228,
    octaves: 3,
  },
  colors: c([0.572549, 0.909804, 0.752941, 1, 0.309804, 0.643137, 0.721569, 1, 0.172549, 0.207843, 0.301961, 1]),
}

export const ISLANDS_LAND: LayerDefaults = {
  params: {
    seed: 7.947,
    rotation: 0.2,
    lightOrigin: [0.39, 0.39],
    timeSpeed: 0.2,
    ditherSize: 2,
    lightBorder1: 0.32,
    lightBorder2: 0.534,
    landCutoff: 0.633,
    size: 4.292,
    octaves: 6,
  },
  colors: c([
    0.784314, 0.831373, 0.364706, 1, 0.388235, 0.670588, 0.247059, 1, 0.184314, 0.341176,
    0.32549, 1, 0.156863, 0.207843, 0.25098, 1,
  ]),
}

export const ISLANDS_CLOUD: LayerDefaults = {
  params: {
    seed: 5.939,
    rotation: 0,
    cloudCover: 0.415,
    lightOrigin: [0.39, 0.39],
    timeSpeed: 0.47,
    stretch: 2,
    cloudCurve: 1.3,
    lightBorder1: 0.52,
    lightBorder2: 0.62,
    size: 7.745,
    octaves: 2,
  },
  colors: c([
    0.87451, 0.878431, 0.909804, 1, 0.639216, 0.654902, 0.760784, 1, 0.407843, 0.435294, 0.6, 1,
    0.25098, 0.286275, 0.45098, 1,
  ]),
}

export const NO_ATMOSPHERE_GROUND: LayerDefaults = {
  params: {
    seed: 1.012,
    rotation: 0,
    lightOrigin: [0.25, 0.25],
    timeSpeed: 0.4,
    ditherSize: 2,
    lightBorder1: 0.615,
    lightBorder2: 0.729,
    size: 8,
    octaves: 4,
  },
  colors: c([
    0.639216, 0.654902, 0.760784, 1, 0.298039, 0.407843, 0.521569, 1, 0.227451, 0.247059,
    0.368627, 1,
  ]),
}

export const NO_ATMOSPHERE_CRATERS: LayerDefaults = {
  params: {
    seed: 4.517,
    rotation: 0,
    lightOrigin: [0.25, 0.25],
    timeSpeed: 0.001,
    lightBorder: 0.465,
    size: 5,
  },
  pixelsRatio: 0.87419,
  colors: c([0.298039, 0.407843, 0.521569, 1, 0.227451, 0.247059, 0.368627, 1]),
}

export const GAS_GIANT_BASE: LayerDefaults = {
  params: {
    seed: 5.939,
    rotation: 0,
    cloudCover: 0,
    lightOrigin: [0.25, 0.25],
    timeSpeed: 0.7,
    stretch: 1,
    cloudCurve: 1.3,
    lightBorder1: 0.692,
    lightBorder2: 0.666,
    size: 9,
    octaves: 5,
  },
  colors: c([
    0.231373, 0.12549, 0.152941, 1, 0.231373, 0.12549, 0.152941, 1, 0, 0, 0, 1, 0.129412,
    0.0941176, 0.105882, 1,
  ]),
}

export const GAS_GIANT_TOP: LayerDefaults = {
  params: {
    seed: 5.939,
    rotation: 0,
    cloudCover: 0.538,
    lightOrigin: [0.25, 0.25],
    timeSpeed: 0.47,
    stretch: 1,
    cloudCurve: 1.3,
    lightBorder1: 0.439,
    lightBorder2: 0.746,
    size: 9,
    octaves: 5,
  },
  colors: c([
    0.941176, 0.709804, 0.254902, 1, 0.811765, 0.458824, 0.168627, 1, 0.670588, 0.317647,
    0.188235, 1, 0.490196, 0.219608, 0.2, 1,
  ]),
}

export const GAS_GIANT_2_GAS: LayerDefaults = {
  params: {
    seed: 6.314,
    rotation: 0,
    cloudCover: 0.61,
    lightOrigin: [-0.1, 0.3],
    timeSpeed: 0.05,
    stretch: 2.204,
    cloudCurve: 1.376,
    lightBorder1: 0.52,
    lightBorder2: 0.62,
    bands: 0.892,
    size: 10.107,
    octaves: 3,
    nColors: 3,
  },
  colors: c([
    0.933333, 0.764706, 0.603922, 1, 0.85098, 0.627451, 0.4, 1, 0.560784, 0.337255, 0.231373, 1,
  ]),
  darkColors: c([
    0.4, 0.223529, 0.192157, 1, 0.270588, 0.156863, 0.235294, 1, 0.133333, 0.12549, 0.203922, 1,
  ]),
}

export const GAS_GIANT_2_RING: LayerDefaults = {
  params: {
    seed: 8.461,
    rotation: 0,
    lightOrigin: [-0.1, 0.3],
    timeSpeed: 0.2,
    ringWidth: 0.127,
    ringPerspective: 6,
    scaleRelToPlanet: 6,
    size: 15,
    octaves: 4,
    nColors: 3,
  },
  pixelsRatio: 3,
  colors: c([
    0.933333, 0.764706, 0.603922, 1, 0.701961, 0.478431, 0.313726, 1, 0.560784, 0.337255,
    0.231373, 1,
  ]),
  darkColors: c([
    0.333333, 0.188235, 0.211765, 1, 0.196078, 0.137255, 0.215686, 1, 0.133333, 0.12549,
    0.203922, 1,
  ]),
}

export const ICE_WORLD_LAND: LayerDefaults = {
  params: {
    seed: 1.036,
    rotation: 0,
    lightOrigin: [0.3, 0.3],
    timeSpeed: 0.25,
    ditherSize: 2,
    lightBorder1: 0.48,
    lightBorder2: 0.632,
    size: 8,
    octaves: 2,
  },
  colors: c([
    0.980392, 1, 1, 1, 0.780392, 0.831373, 0.882353, 1, 0.572549, 0.560784, 0.721569, 1,
  ]),
}

export const ICE_WORLD_LAKES: LayerDefaults = {
  params: {
    seed: 1.14,
    rotation: 0,
    lightOrigin: [0.3, 0.3],
    timeSpeed: 0.2,
    lightBorder1: 0.024,
    lightBorder2: 0.047,
    lakeCutoff: 0.55,
    size: 10,
    octaves: 3,
  },
  colors: c([
    0.309804, 0.643137, 0.721569, 1, 0.298039, 0.407843, 0.521569, 1, 0.227451, 0.247059,
    0.368627, 1,
  ]),
}

export const ICE_WORLD_CLOUD: LayerDefaults = {
  params: {
    seed: 1.14,
    rotation: 0,
    cloudCover: 0.546,
    lightOrigin: [0.3, 0.3],
    timeSpeed: 0.1,
    stretch: 2.5,
    cloudCurve: 1.3,
    lightBorder1: 0.566,
    lightBorder2: 0.781,
    size: 4,
    octaves: 4,
  },
  colors: c([
    0.882353, 0.94902, 1, 1, 0.752941, 0.890196, 1, 1, 0.368627, 0.439216, 0.647059, 1, 0.25098,
    0.286275, 0.45098, 1,
  ]),
}

export const LAVA_WORLD_LAND: LayerDefaults = {
  params: {
    seed: 1.551,
    rotation: 0,
    lightOrigin: [0.3, 0.3],
    timeSpeed: 0.2,
    ditherSize: 2,
    lightBorder1: 0.4,
    lightBorder2: 0.6,
    size: 10,
    octaves: 3,
  },
  colors: c([
    0.560784, 0.301961, 0.341176, 1, 0.321569, 0.2, 0.247059, 1, 0.239216, 0.160784, 0.211765, 1,
  ]),
}

export const LAVA_WORLD_CRATERS: LayerDefaults = {
  params: {
    seed: 1.561,
    rotation: 0,
    lightOrigin: [0.3, 0.3],
    timeSpeed: 0.2,
    lightBorder: 0.4,
    size: 3.5,
  },
  colors: c([0.321569, 0.2, 0.247059, 1, 0.239216, 0.160784, 0.211765, 1]),
}

export const LAVA_WORLD_RIVERS: LayerDefaults = {
  params: {
    seed: 2.527,
    rotation: 0,
    lightOrigin: [0.3, 0.3],
    timeSpeed: 0.2,
    lightBorder1: 0.019,
    lightBorder2: 0.036,
    riverCutoff: 0.579,
    size: 10,
    octaves: 4,
  },
  colors: c([
    1, 0.537255, 0.2, 1, 0.901961, 0.270588, 0.223529, 1, 0.678431, 0.184314, 0.270588, 1,
  ]),
}

export const ASTEROID: LayerDefaults = {
  params: {
    seed: 1.567,
    rotation: 0,
    lightOrigin: [0, 0],
    timeSpeed: 0.4,
    size: 5.294,
    octaves: 2,
  },
  colors: c([
    0.639216, 0.654902, 0.760784, 1, 0.298039, 0.407843, 0.521569, 1, 0.227451, 0.247059,
    0.368627, 1,
  ]),
}

export const BLACK_HOLE_CORE: LayerDefaults = {
  params: {
    radius: 0.247,
    lightWidth: 0.028,
  },
  colors: c([0.152941, 0.152941, 0.211765, 1, 1, 1, 0.921569, 1, 0.929412, 0.482353, 0.223529, 1]),
}

export const BLACK_HOLE_DISK: LayerDefaults = {
  params: {
    seed: 8.175,
    rotation: 0.066,
    lightOrigin: [0.607, 0.444],
    timeSpeed: 0.2,
    diskWidth: 0.065,
    ringPerspective: 14,
    size: 6.598,
    octaves: 3,
    nColors: 5,
  },
  pixelsRatio: 3,
  colors: c([
    1, 1, 0.921569, 1, 1, 0.960784, 0.25098, 1, 1, 0.721569, 0.290196, 1, 0.929412, 0.482353,
    0.223529, 1, 0.741176, 0.25098, 0.207843, 1,
  ]),
}

export const GALAXY: LayerDefaults = {
  params: {
    seed: 5.881,
    rotation: 0.674,
    timeSpeed: 1,
    ditherSize: 2,
    size: 7,
    octaves: 1,
    nColors: 6,
    tilt: 3,
    nLayers: 4,
    layerHeight: 0.4,
    zoom: 1.375,
    swirl: -9,
  },
  pixelsRatio: 2,
  colors: c([
    1, 1, 0.921569, 1, 1, 0.913725, 0.552941, 1, 0.709804, 0.878431, 0.4, 1, 0.396078,
    0.647059, 0.4, 1, 0.223529, 0.364706, 0.392157, 1, 0.196078, 0.223529, 0.301961, 1,
    0.196078, 0.160784, 0.278431, 1,
  ]),
}

export const STAR_BLOBS: LayerDefaults = {
  params: {
    seed: 3.078,
    rotation: 0,
    timeSpeed: 0.05,
    circleAmount: 2,
    circleSize: 1,
    size: 4.93,
    octaves: 4,
  },
  pixelsRatio: 2,
  colors: c([1, 1, 0.894118, 1]),
}

export const STAR_SURFACE: LayerDefaults = {
  params: {
    seed: 4.837,
    rotation: 0,
    timeSpeed: 0.05,
    size: 4.463,
    octaves: 4,
    tiles: 1,
    nColors: 4,
  },
  colors: c([
    0.960784, 1, 0.909804, 1, 0.466667, 0.839216, 0.756863, 1, 0.109804, 0.572549, 0.654902, 1,
    0.0117647, 0.243137, 0.368627, 1,
  ]),
}

export const STAR_FLARES: LayerDefaults = {
  params: {
    seed: 3.078,
    rotation: 0,
    timeSpeed: 0.05,
    stormWidth: 0.3,
    stormDitherWidth: 0,
    scale: 1,
    circleAmount: 2,
    circleScale: 1,
    size: 1.6,
    octaves: 4,
  },
  pixelsRatio: 2,
  colors: c([0.466667, 0.839216, 0.756863, 1, 1, 1, 0.894118, 1]),
}
