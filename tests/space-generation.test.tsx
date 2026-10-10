/** @jsxImportSource @opentui/react */
import { describe, expect, test } from 'bun:test'
import { glslMod, smoothstep } from '../termweave/space/glsl'
import { createRng } from '../termweave/space/random'
import {
  SPACE_OBJECTS,
  SPACE_OBJECT_TYPES,
  objectBufferSize,
  renderSpaceObject,
  spaceObjectLayerNames,
  type SpaceObjectConfig,
} from '../termweave/space/space-objects'
import { REALISTIC_PALETTES, spaceObjectPaletteNames } from '../termweave/space/palettes'
import {
  BACKGROUND_HEIGHT,
  BACKGROUND_WIDTH,
  renderBackground,
} from '../termweave/space/background'
import { randomSpaceObjectConfig } from '../termweave/space/random'

const SEEDS = [9693, 9231, 9308, 9385, 9539, 9847, 9924, 10232, 10386, 10463, 10155, 9616]

function configForType(type: (typeof SPACE_OBJECT_TYPES)[number]): SpaceObjectConfig {
  const seed = SEEDS[SPACE_OBJECT_TYPES.indexOf(type)]!
  return { type, seed }
}

describe('space foundations', () => {
  test('GLSL mod keeps the divisor sign, unlike JS %', () => {
    expect(glslMod(-3, 5)).toBe(2)
    expect(-3 % 5).toBe(-3)
    expect(glslMod(3, 5)).toBe(3)
  })

  test('smoothstep survives equal and inverted edges', () => {
    expect(smoothstep(1, 1, 0.5)).toBe(0)
    expect(smoothstep(1, 1, 2)).toBe(1)
    expect(smoothstep(1, 0, 0.5)).toBeCloseTo(0.5, 5)
  })

  test('the RNG is deterministic and in-range', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 100; i += 1) {
      expect(a.randi()).toBe(b.randi())
    }
    const rng = createRng(7)
    for (let i = 0; i < 100; i += 1) {
      const value = rng.randfRange(2, 5)
      expect(value).toBeGreaterThanOrEqual(2)
      expect(value).toBeLessThanOrEqual(5)
    }
  })
})

describe('space objects', () => {
  test('quad sizes: 48 for planets, 64 for the asteroid, 144 for the big kinds', () => {
    const expected: Record<string, number> = {
      'terran-wet': 48,
      'terran-dry': 48,
      islands: 48,
      'no-atmosphere': 48,
      'gas-giant-1': 48,
      'gas-giant-2': 144,
      'ice-world': 48,
      'lava-world': 48,
      asteroid: 64,
      'black-hole': 144,
      galaxy: 144,
      star: 144,
    }
    for (const type of SPACE_OBJECT_TYPES) {
      expect(objectBufferSize(type)).toBe(expected[type])
    }
  })

  test('every type renders its type-sized buffer with structure', () => {
    for (const type of SPACE_OBJECT_TYPES) {
      const buffer = renderSpaceObject(configForType(type))
      const size = objectBufferSize(type)
      expect(buffer.width).toBe(size)
      expect(buffer.height).toBe(size)

      let opaque = 0
      const distinct = new Set<string>()
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const offset = (y * size + x) * 4
          if (buffer.data[offset + 3]! > 0) {
            opaque += 1
            distinct.add(`${buffer.data[offset]},${buffer.data[offset + 1]},${buffer.data[offset + 2]}`)
          }
        }
      }
      expect(buffer.data[3]!).toBe(0)
      expect(opaque).toBeGreaterThan(500)
      expect(distinct.size).toBeGreaterThanOrEqual(3)
    }
  })

  test('colors are optional: omitted colors use the .tscn default palettes', () => {
    const buffer = renderSpaceObject({ type: 'terran-wet', seed: 42 })
    expect(buffer.width).toBe(48)
    let sawDefaultLand = false
    for (let i = 0; i < buffer.data.length; i += 4) {
      if (
        buffer.data[i] === 99 &&
        buffer.data[i + 1] === 171 &&
        buffer.data[i + 2] === 63 &&
        buffer.data[i + 3]! > 0
      ) {
        sawDefaultLand = true
        break
      }
    }
    expect(sawDefaultLand).toBeTrue()
  })

  test('rendering is deterministic for the same config', () => {
    const config = randomSpaceObjectConfig(4242)
    const first = renderSpaceObject(config)
    const second = renderSpaceObject(config)
    expect(Buffer.from(first.data).equals(Buffer.from(second.data))).toBeTrue()
  })

  test('different seeds change the output', () => {
    const base = randomSpaceObjectConfig(4242)
    const otherSeed = renderSpaceObject({ ...base, seed: 4243 })
    const reference = renderSpaceObject(base)
    expect(Buffer.from(otherSeed.data).equals(Buffer.from(reference.data))).toBeFalse()
  })

  test('layer toggles change the render', () => {
    const config = randomSpaceObjectConfig(4242)
    const layers = spaceObjectLayerNames(config.type)
    if (layers.length < 2) return
    const full = renderSpaceObject(config)
    const withoutSecond = renderSpaceObject(
      { ...config, layers: { [layers[1]!]: false } },
    )
    expect(Buffer.from(withoutSecond.data).equals(Buffer.from(full.data))).toBeFalse()
  })

  test('pixelScale regenerates at higher pixel density, not an upscale', () => {
    const config = { type: 'galaxy' as const, seed: 4242 }
    const base = renderSpaceObject(config)
    const doubled = renderSpaceObject(config, 2)
    expect(doubled.width).toBe(288)
    expect(doubled.height).toBe(288)
    expect(Buffer.from(doubled.data).equals(Buffer.from(base.data))).toBeFalse()
    expect(Buffer.from(doubled.data).equals(Buffer.from(renderSpaceObject(config, 2).data))).toBeTrue()
  })

  test('curated palettes: every type has a list, correctly shaped', () => {
    for (const type of SPACE_OBJECT_TYPES) {
      const palettes = REALISTIC_PALETTES[type]
      expect(palettes.length).toBeGreaterThanOrEqual(3)
      for (const palette of palettes) {
        for (const layer of SPACE_OBJECTS[type].layers) {
          const colors = palette.colors[layer.name]
          if (colors !== undefined) {
            expect(colors.length, `${type}/${palette.name}/${layer.name}`).toBe(
              layer.defaults.colors.length,
            )
          }
          const darkColors = palette.darkColors?.[layer.name]
          if (darkColors !== undefined && layer.defaults.darkColors) {
            expect(darkColors.length, `${type}/${palette.name}/${layer.name}:dark`).toBe(
              layer.defaults.darkColors.length,
            )
          }
        }
      }
    }
  })

  test('every curated palette renders', () => {
    for (const type of SPACE_OBJECT_TYPES) {
      for (const palette of REALISTIC_PALETTES[type]) {
        const buffer = renderSpaceObject({ type, seed: 4242, palette: palette.name })
        expect(buffer.width).toBe(objectBufferSize(type))
        expect(buffer.data.some((value) => value > 0)).toBeTrue()
      }
    }
  })

  test('the palette changes the colors of the render', () => {
    const moon = renderSpaceObject({ type: 'no-atmosphere', seed: 42, palette: 'moon' })
    const mars = renderSpaceObject({ type: 'no-atmosphere', seed: 42, palette: 'mars-dead' })
    expect(Buffer.from(moon.data).equals(Buffer.from(mars.data))).toBeFalse()
  })

  test('unknown palette names throw', () => {
    expect(() => renderSpaceObject({ type: 'terran-wet', palette: 'toxic-green' })).toThrow(
      /Unknown palette/,
    )
  })

  test('random configs roll every type across a seed sweep', () => {
    const types = new Set<string>()
    for (let index = 0; index < 240; index += 1) {
      const config = randomSpaceObjectConfig(1000 + index * 37)
      types.add(config.type)
      expect(config.palette).toBeDefined()
      expect(spaceObjectPaletteNames(config.type)).toContain(config.palette!)
    }
    expect([...types].sort()).toEqual([...SPACE_OBJECT_TYPES].sort())
  })
})

describe('space background', () => {
  test('renders a fully opaque 256×144 buffer with ramp structure', async () => {
    const buffer = await renderBackground(424242)
    expect(buffer.width).toBe(BACKGROUND_WIDTH)
    expect(buffer.height).toBe(BACKGROUND_HEIGHT)

    const distinct = new Set<string>()
    for (let i = 3; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]!).toBe(255)
    }
    for (let i = 0; i < buffer.data.length; i += 4) {
      distinct.add(`${buffer.data[i]},${buffer.data[i + 1]},${buffer.data[i + 2]}`)
    }
    expect(distinct.size).toBeGreaterThanOrEqual(4)
  })

  test('the layout seed changes the output; rendering is deterministic', async () => {
    const base = await renderBackground(777)
    const otherSeed = await renderBackground(778)
    expect(Buffer.from(otherSeed.data).equals(Buffer.from(base.data))).toBeFalse()
    expect(Buffer.from((await renderBackground(777)).data).equals(Buffer.from(base.data))).toBeTrue()
  })
})

describe('SpaceObject component', () => {
  test('mounts with a seed, paints glyphs, and keeps meshes in the frustum', async () => {
    const { SpaceObject } = await import('../termweave/space/SpaceObject')
    const { testRender } = await import('@opentui/react/test-utils')
    const { Mesh } = await import('three')
    const object = randomSpaceObjectConfig(9693)
    const renderableRef: { current: { getScene: () => unknown; getActiveCamera: () => { position: { z: number }; near: number } } | null } = { current: null }
    const setup = await testRender(
      <SpaceObject
        object={object}
        backgroundSeed={9693}
        width={64}
        height={36}
        onReady={(renderable) => {
          renderableRef.current = renderable
        }}
      />,
      { width: 64, height: 36 },
    )
    try {
      const renderable = renderableRef.current
      expect(renderable).not.toBeNull()
      const camera = renderable!.getActiveCamera()
      let meshes = 0
      ;(renderable!.getScene() as { traverse: (cb: (child: unknown) => void) => void }).traverse((child) => {
        if (child instanceof Mesh) {
          meshes += 1
          const z = (child as { position: { z: number } }).position.z
          expect(z, `mesh z=${z} must sit in front of the near plane`).toBeLessThan(camera.position.z - camera.near)
        }
      })
      expect(meshes).toBeGreaterThanOrEqual(2)
      const painted = await Bun.sleep(1200).then(() => setup.captureCharFrame())
      expect(painted).not.toContain('ThreeRenderer:')
      expect(painted).toMatch(/[█▀▄▌▐▖▗▘▝▚▞]/)
    } finally {
      setup.renderer.destroy()
    }
  })

  test('SpaceScreen renders the config panel', async () => {
    const { SpaceScreen } = await import('../app/space')
    const { testRender } = await import('@opentui/react/test-utils')
    const setup = await testRender(
      <SpaceScreen
        spaceConfig={{
          objectType: 'terran-wet',
          palette: 'earth',
          objectSeed: 4242,
          backgroundSeed: 7,
        }}
        onSpaceConfigChange={() => {}}
        onRandomize={() => {}}
      />,
      { width: 80, height: 40 },
    )
    try {
      const painted = await Bun.sleep(1500).then(() => setup.captureCharFrame())
      expect(painted).toContain('SPACE CONFIG')
      expect(painted).toContain('TYPE')
      expect(painted).toContain('PALETTE')
      expect(painted).toContain('RANDOMIZE')
      expect(painted).toContain('TERRAN WET')
      expect(painted).toContain('EARTH')
      expect(painted).not.toContain('PARENT')
      expect(painted).not.toContain('SIBLINGS')
      expect(painted).not.toContain('ThreeRenderer:')
    } finally {
      setup.renderer.destroy()
    }
  })
})
