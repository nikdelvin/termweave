import { createRng } from './random'
import { createFrameBuffer, type FrameBuffer } from './pixels'
import { REALISTIC_PALETTES } from './palettes'
import type { LayerParams, LayerPixelFn } from './object-shaders/layer'
import { renderLayer } from './object-shaders/layer'
import type { LayerDefaults } from './objects'
import {
  ASTEROID,
  BLACK_HOLE_CORE,
  BLACK_HOLE_DISK,
  GAS_GIANT_2_GAS,
  GAS_GIANT_2_RING,
  GAS_GIANT_BASE,
  GAS_GIANT_TOP,
  GALAXY,
  ICE_WORLD_CLOUD,
  ICE_WORLD_LAKES,
  ICE_WORLD_LAND,
  ISLANDS_CLOUD,
  ISLANDS_LAND,
  ISLANDS_WATER,
  LAVA_WORLD_CRATERS,
  LAVA_WORLD_LAND,
  LAVA_WORLD_RIVERS,
  NO_ATMOSPHERE_CRATERS,
  NO_ATMOSPHERE_GROUND,
  STAR_BLOBS,
  STAR_FLARES,
  STAR_SURFACE,
  TERRAN_DRY_LAND,
  TERRAN_WET_CLOUD,
  TERRAN_WET_LAND,
} from './objects'
import { createAsteroids } from './object-shaders/asteroids'
import { createBlackHole } from './object-shaders/black-hole'
import { createBlackHoleRing } from './object-shaders/black-hole-ring'
import { createClouds } from './object-shaders/clouds'
import { createCraters } from './object-shaders/craters'
import { createDryTerran } from './object-shaders/dry-terran'
import { createGalaxy } from './object-shaders/galaxy'
import { createGasLayers } from './object-shaders/gas-layers'
import { createLakes } from './object-shaders/lakes'
import { createLandRivers } from './object-shaders/land-rivers'
import { createLavaRivers } from './object-shaders/lava-rivers'
import { createNoAtmosphere } from './object-shaders/no-atmosphere'
import { createPlanetLandmass } from './object-shaders/planet-landmass'
import { createPlanetUnder } from './object-shaders/planet-under'
import { createRing } from './object-shaders/ring'
import { createStar } from './object-shaders/star'
import { createStarBlobs } from './object-shaders/star-blobs'
import { createStarFlares } from './object-shaders/star-flares'

export type SpaceObjectType =
  | 'terran-wet'
  | 'terran-dry'
  | 'islands'
  | 'no-atmosphere'
  | 'gas-giant-1'
  | 'gas-giant-2'
  | 'ice-world'
  | 'lava-world'
  | 'asteroid'
  | 'black-hole'
  | 'galaxy'
  | 'star'

export interface SpaceObjectConfig {
  type: SpaceObjectType
  seed?: number
  palette?: string
  layers?: Partial<Record<string, boolean>>
}

const INITIAL_TIME = 1000

function multiplierTime(defaults: LayerDefaults, factor: number): number {
  const size = defaults.params.size ?? 50
  const timeSpeed = defaults.params.timeSpeed ?? 0.2
  return INITIAL_TIME * ((Math.round(size) * 2) / timeSpeed) * factor
}

const RING_TIME = INITIAL_TIME * 314.15 * 0.004

interface ObjectLayerSpec {
  name: string
  create: (p: LayerParams, time: number, timeSpeed: number) => LayerPixelFn
  defaults: LayerDefaults
  rectScale?: number
  rectOffset?: number
  rotationOffset?: number
  time: number
  seedDraw?: 'cloud-cover-035-06' | 'cloud-cover-028-05'
}

interface SpaceObjectSpec {
  relativeScale: number
  bufferSize: number
  layers: ObjectLayerSpec[]
}

export const SPACE_OBJECT_TYPES: readonly SpaceObjectType[] = [
  'terran-wet',
  'terran-dry',
  'islands',
  'no-atmosphere',
  'gas-giant-1',
  'gas-giant-2',
  'ice-world',
  'lava-world',
  'asteroid',
  'black-hole',
  'galaxy',
  'star',
]

export const SPACE_OBJECTS: Record<SpaceObjectType, SpaceObjectSpec> = {
  'terran-wet': {
    relativeScale: 1,
    bufferSize: 48,
    layers: [
      { name: 'land', create: createLandRivers, defaults: TERRAN_WET_LAND, time: multiplierTime(TERRAN_WET_LAND, 0.02) },
      { name: 'clouds', create: createClouds, defaults: TERRAN_WET_CLOUD, time: multiplierTime(TERRAN_WET_CLOUD, 0.01), seedDraw: 'cloud-cover-035-06' },
    ],
  },
  'terran-dry': {
    relativeScale: 1,
    bufferSize: 48,
    layers: [
      { name: 'land', create: createDryTerran, defaults: TERRAN_DRY_LAND, time: multiplierTime(TERRAN_DRY_LAND, 0.02) },
    ],
  },
  islands: {
    relativeScale: 1,
    bufferSize: 48,
    layers: [
      { name: 'water', create: createPlanetUnder, defaults: ISLANDS_WATER, time: multiplierTime(ISLANDS_WATER, 0.02) },
      { name: 'land', create: createPlanetLandmass, defaults: ISLANDS_LAND, time: multiplierTime(ISLANDS_LAND, 0.02) },
      { name: 'clouds', create: createClouds, defaults: ISLANDS_CLOUD, time: multiplierTime(ISLANDS_CLOUD, 0.01), seedDraw: 'cloud-cover-035-06' },
    ],
  },
  'no-atmosphere': {
    relativeScale: 1,
    bufferSize: 48,
    layers: [
      { name: 'ground', create: createNoAtmosphere, defaults: NO_ATMOSPHERE_GROUND, time: multiplierTime(NO_ATMOSPHERE_GROUND, 0.02) },
      { name: 'craters', create: createCraters, defaults: NO_ATMOSPHERE_CRATERS, time: multiplierTime(NO_ATMOSPHERE_CRATERS, 0.02) },
    ],
  },
  'gas-giant-1': {
    relativeScale: 1,
    bufferSize: 48,
    layers: [
      { name: 'clouds', create: createClouds, defaults: GAS_GIANT_BASE, time: multiplierTime(GAS_GIANT_BASE, 0.005) },
      { name: 'clouds-top', create: createClouds, defaults: GAS_GIANT_TOP, time: multiplierTime(GAS_GIANT_TOP, 0.005), seedDraw: 'cloud-cover-028-05' },
    ],
  },
  'gas-giant-2': {
    relativeScale: 3,
    bufferSize: 144,
    layers: [
      { name: 'gas', create: createGasLayers, defaults: GAS_GIANT_2_GAS, time: multiplierTime(GAS_GIANT_2_GAS, 0.004) },
      { name: 'ring', create: createRing, defaults: GAS_GIANT_2_RING, rectScale: 3, rectOffset: -1, rotationOffset: 0.7, time: RING_TIME },
    ],
  },
  'ice-world': {
    relativeScale: 1,
    bufferSize: 48,
    layers: [
      { name: 'land', create: createPlanetUnder, defaults: ICE_WORLD_LAND, time: multiplierTime(ICE_WORLD_LAND, 0.02) },
      { name: 'lakes', create: createLakes, defaults: ICE_WORLD_LAKES, time: multiplierTime(ICE_WORLD_LAKES, 0.02) },
      { name: 'clouds', create: createClouds, defaults: ICE_WORLD_CLOUD, time: multiplierTime(ICE_WORLD_CLOUD, 0.01) },
    ],
  },
  'lava-world': {
    relativeScale: 1,
    bufferSize: 48,
    layers: [
      { name: 'land', create: createNoAtmosphere, defaults: LAVA_WORLD_LAND, time: multiplierTime(LAVA_WORLD_LAND, 0.02) },
      { name: 'craters', create: createCraters, defaults: LAVA_WORLD_CRATERS, time: multiplierTime(LAVA_WORLD_CRATERS, 0.02) },
      { name: 'lava', create: createLavaRivers, defaults: LAVA_WORLD_RIVERS, time: multiplierTime(LAVA_WORLD_RIVERS, 0.02) },
    ],
  },
  asteroid: {
    relativeScale: 1,
    bufferSize: 64,
    layers: [
      { name: 'asteroid', create: createAsteroids, defaults: ASTEROID, time: 0 },
    ],
  },
  'black-hole': {
    relativeScale: 2,
    bufferSize: 144,
    layers: [
      { name: 'core', create: createBlackHole, defaults: BLACK_HOLE_CORE, time: 0 },
      {
        name: 'disk',
        create: createBlackHoleRing,
        defaults: BLACK_HOLE_DISK,
        rectScale: 3,
        rectOffset: -1,
        rotationOffset: 0.7,
        time: RING_TIME,
      },
    ],
  },
  galaxy: {
    relativeScale: 1,
    bufferSize: 144,
    layers: [
      { name: 'galaxy', create: createGalaxy, defaults: GALAXY, time: multiplierTime(GALAXY, 0.04) },
    ],
  },
  star: {
    relativeScale: 2,
    bufferSize: 144,
    layers: [
      { name: 'blobs', create: createStarBlobs, defaults: STAR_BLOBS, rectScale: 2, rectOffset: -0.5, time: multiplierTime(STAR_BLOBS, 0.01) },
      { name: 'star', create: createStar, defaults: STAR_SURFACE, time: multiplierTime(STAR_SURFACE, 0.005) },
      { name: 'flares', create: createStarFlares, defaults: STAR_FLARES, rectScale: 2, rectOffset: -0.5, time: multiplierTime(STAR_FLARES, 0.015) },
    ],
  },
}

export function spaceObjectLayerNames(type: SpaceObjectType): string[] {
  return SPACE_OBJECTS[type].layers.map((layer) => layer.name)
}

function resolvePalette(config: SpaceObjectConfig) {
  if (config.palette === undefined) return undefined
  const palette = REALISTIC_PALETTES[config.type].find((entry) => entry.name === config.palette)
  if (!palette) {
    throw new Error(
      `Unknown palette "${config.palette}" for space object type "${config.type}".`,
    )
  }
  return palette
}

export function objectBufferSize(type: SpaceObjectType): number {
  return SPACE_OBJECTS[type].bufferSize
}

export function renderSpaceObject(config: SpaceObjectConfig, pixelScale = 1): FrameBuffer {
  const spec = SPACE_OBJECTS[config.type]
  const palette = resolvePalette(config)
  const hasSeed = config.seed !== undefined
  const rng = hasSeed ? createRng(config.seed!) : undefined
  const convertedSeed = hasSeed ? (config.seed! % 1000) / 100 : undefined
  const bufferSize = Math.round(spec.bufferSize * pixelScale)
  const disc = bufferSize / spec.relativeScale
  const planetOffset = (bufferSize - disc) / 2
  const buffer = createFrameBuffer(bufferSize, bufferSize)
  for (const layer of spec.layers) {
    if (config.layers?.[layer.name] === false) continue
    const { timeSpeed, ...paramDefaults } = layer.defaults.params
    let cloudCover = layer.defaults.params.cloudCover
    if (rng) {
      if (layer.seedDraw === 'cloud-cover-035-06') {
        cloudCover = rng.randfRange(0.35, 0.6)
      } else if (layer.seedDraw === 'cloud-cover-028-05') {
        cloudCover = rng.randfRange(0.28, 0.5)
      }
    }
    const params: LayerParams = {
      ...paramDefaults,
      pixels: Math.round(disc * (layer.defaults.pixelsRatio ?? 1)),
      lightOrigin: layer.defaults.params.lightOrigin ?? [0.39, 0.39],
      rotation: (layer.defaults.params.rotation ?? 0) + (layer.rotationOffset ?? 0),
      size: layer.defaults.params.size ?? 50,
      octaves: layer.defaults.params.octaves ?? 3,
      seed: convertedSeed ?? layer.defaults.params.seed ?? 1,
      cloudCover,
      colors: palette?.colors?.[layer.name] ?? layer.defaults.colors,
      darkColors: palette?.darkColors?.[layer.name] ?? layer.defaults.darkColors,
    }
    const rectScale = layer.rectScale ?? 1
    const rectOffset = layer.rectOffset ?? 0
    const rectSize = disc * rectScale
    renderLayer(
      buffer,
      {
        x: planetOffset + disc * rectOffset,
        y: planetOffset + disc * rectOffset,
        width: rectSize,
        height: rectSize,
      },
      layer.create(params, layer.time, timeSpeed ?? 0.2),
    )
  }
  return buffer
}
