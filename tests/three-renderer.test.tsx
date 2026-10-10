/** @jsxImportSource @opentui/react */
import { describe, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three'
import { quantizeChannel, quantizeRgb332 } from '../termweave/color'
import { quantizeBufferRegion } from '../termweave/three/buffer-palette'
import { ThreeRenderer, formatThreeRendererError } from '../termweave/three/ThreeRenderer'
import { useFrame } from '../termweave/three/useFrame'

describe('RGB332 cell quantization', () => {
  test('maps channels onto the 3/3/2-bit cube', () => {
    expect(quantizeChannel(255, 3)).toBe(255)
    expect(quantizeChannel(0, 3)).toBe(0)
    expect(quantizeChannel(200, 3)).toBe(182)
    expect(quantizeChannel(200, 2)).toBe(170)
    expect(quantizeRgb332([255, 200, 200])).toEqual([255, 182, 170])
  })

  test('quantizes a rectangular buffer region in place while preserving metadata', () => {
    const width = 4
    const height = 2
    const cellCount = width * height
    const fg = new Uint16Array(cellCount * 4)
    const bg = new Uint16Array(cellCount * 4)
    const redIndex = (0 * width + 1) * 4
    fg[redIndex] = 0x0100 | 200
    fg[redIndex + 1] = 0x0200
    fg[redIndex + 2] = 0x0300 | 40
    const blueIndex = (1 * width + 3) * 4
    bg[blueIndex] = 0x0400 | 10
    bg[blueIndex + 1] = 0x0500 | 220
    bg[blueIndex + 2] = 0x0600 | 230
    quantizeBufferRegion({ buffers: { fg, bg }, width, height }, 1, 0, 2, 1)
    expect(fg[redIndex]).toBe(0x0100 | 182)
    expect(fg[redIndex + 1]).toBe(0x0200)
    expect(fg[redIndex + 2]).toBe(0x0300 | 0)
    expect(bg[blueIndex]).toBe(0x0400 | 10)
    expect(bg[blueIndex + 1]).toBe(0x0500 | 220)
    expect(bg[blueIndex + 2]).toBe(0x0600 | 230)
    expect(fg[(0 * width + 2) * 4]).toBe(0)
  })

  test('clips out-of-bounds regions to the buffer', () => {
    const buffer = {
      buffers: { fg: new Uint16Array(2 * 2 * 4), bg: new Uint16Array(2 * 2 * 4) },
      width: 2,
      height: 2,
    }
    expect(() => quantizeBufferRegion(buffer, -5, -5, 100, 100)).not.toThrow()
    expect(() => quantizeBufferRegion(buffer, 4, 4, 2, 2)).not.toThrow()
  })
})

describe('three renderer helpers', () => {
  test('formats renderer errors with bounded length', () => {
    expect(formatThreeRendererError(new Error(' boom '))).toBe('boom')
    expect(formatThreeRendererError('')).toBe('Unknown three.js error.')
    expect(formatThreeRendererError('x'.repeat(400)).length).toBe(220)
  })
})

function createSmokeScene() {
  const scene = new Scene()
  const cube = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial({ color: 0x00ff00 }))
  scene.add(cube)
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 4)
  return { scene, camera }
}

describe('ThreeRenderer component', () => {
  test('paints a three scene into the frame without errors', async () => {
    const { scene, camera } = createSmokeScene()
    const errors: string[] = []
    const setup = await testRender(
      <ThreeRenderer
        scene={scene}
        camera={camera}
        width={20}
        height={10}
        onError={(message) => errors.push(message)}
      >
        <text>SMOKE</text>
      </ThreeRenderer>,
      { width: 24, height: 12 },
    )
    try {
      const frame = await setup.waitForFrame((captured) => captured.includes('SMOKE'))
      expect(frame).toContain('SMOKE')
      const painted = await Bun.sleep(1500).then(() => setup.captureCharFrame())
      expect(painted).not.toContain('ThreeRenderer:')
      expect(errors).toEqual([])
      expect(painted).toMatch(/[█▀▄▌▐▖▗▘▝▚▞]/)
    } finally {
      setup.renderer.destroy()
    }
  })

  test('a root-level overlay out-stacks a nested box with a higher zIndex', async () => {
    function Frame() {
      return (
        <box width="100%" height="100%">
          <box width="100%" height="100%">
            <box position="absolute" top={0} left={0} width="100%" minHeight={3} zIndex={10}>
              <text>NESTED-Z10</text>
            </box>
          </box>
          <box position="absolute" top={0} left={0} width="100%" zIndex={20}>
            <text>ROOT-Z20</text>
          </box>
        </box>
      )
    }
    const setup = await testRender(<Frame />, { width: 30, height: 6 })
    try {
      const frame = await setup.waitForFrame((captured) => captured.includes('ROOT-Z20'))
      expect(frame).toContain('ROOT-Z20')
      expect(frame).not.toContain('NESTED')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('useFrame ticks while mounted and holds the live loop open', async () => {
    const { scene } = createSmokeScene()
    const ticks: number[] = []

    function AnimatedScene() {
      useFrame((deltaTime) => {
        ticks.push(deltaTime)
      })
      return <ThreeRenderer scene={scene} width={16} height={8} />
    }

    const setup = await testRender(<AnimatedScene />, { width: 20, height: 10 })
    try {
      await Bun.sleep(1200)
      expect(ticks.length).toBeGreaterThan(0)
      expect(setup.renderer.liveRequestCount).toBeGreaterThan(0)
    } finally {
      setup.renderer.destroy()
    }
  })
})
