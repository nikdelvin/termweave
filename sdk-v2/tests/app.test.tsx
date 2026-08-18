import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { InputRenderable, OptimizedBuffer } from '@opentui/core'
import type { TestRendererSetup } from '@opentui/core/testing'
import { testRender } from '@opentui/solid'
import { onMount } from 'solid-js'
import { App } from '../app/App'
import { navigate, resetAppState } from '../app/store'
import { AppStatePanel, appStateInputId } from '../app/components/AppStatePanel'
import { screens, type ScreenKey } from '../app/screens'
import { PixelRenderer } from '../termweave/components/PixelRenderer'

const TEST_SIZE = { width: 320, height: 180 }
const ANIMATION_SCREEN: ScreenKey = 'animation'
const PICTURE_SCREEN: ScreenKey = 'picture'
const PLAIN_SCREEN: ScreenKey = 'plain'

function findInput(setup: TestRendererSetup, screen: ScreenKey) {
  return setup.renderer.root.findDescendantById(appStateInputId(screen)) as
    InputRenderable | undefined
}

async function waitForFocusedInput(setup: TestRendererSetup, screen: ScreenKey) {
  await setup.waitFor(() => findInput(setup, screen)?.focused === true)
  return findInput(setup, screen)!
}

beforeEach(() => {
  resetAppState()
  navigate(ANIMATION_SCREEN)
})
afterEach(() => {
  resetAppState()
  navigate(ANIMATION_SCREEN)
})

describe('native Solid screens', () => {
  test('renders and focuses all supported initial screens', async () => {
    for (const [screen, present, absent] of [
      [ANIMATION_SCREEN, 'ANIMATION SCREEN', ['PICTURE SCREEN', 'PLAIN SCREEN']],
      [PICTURE_SCREEN, 'PICTURE SCREEN', ['ANIMATION SCREEN', 'PLAIN SCREEN']],
      [PLAIN_SCREEN, 'PLAIN SCREEN', ['ANIMATION SCREEN', 'PICTURE SCREEN']],
    ] as const) {
      navigate(screen)
      const setup = await testRender(() => <App />, TEST_SIZE)
      try {
        const frame = await setup.waitForFrame((candidate) => candidate.includes(present))
        for (const marker of absent) expect(frame).not.toContain(marker)
        expect((await waitForFocusedInput(setup, screen)).focused).toBe(true)
      } finally {
        setup.renderer.destroy()
      }
    }
  })

  test('registers every screen once and follows direct navigate calls while mounted', async () => {
    expect(Object.keys(screens).sort()).toEqual(
      [ANIMATION_SCREEN, PICTURE_SCREEN, PLAIN_SCREEN].sort(),
    )

    const setup = await testRender(() => <App />, TEST_SIZE)
    try {
      const animationInput = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      const appRoot = setup.renderer.root.getChildrenSortedByPrimaryAxis()[0]!
      const mediaRenderer = appRoot.getChildrenSortedByPrimaryAxis()[0]!
      expect(mediaRenderer.renderAfter).toBeDefined()

      navigate(PICTURE_SCREEN)
      const pictureInput = await waitForFocusedInput(setup, PICTURE_SCREEN)
      expect(animationInput.isDestroyed).toBe(true)
      expect(mediaRenderer.isDestroyed).toBe(false)
      expect(appRoot.getChildrenSortedByPrimaryAxis()[0]).toBe(mediaRenderer)

      navigate(PICTURE_SCREEN)
      await setup.flush()
      expect(findInput(setup, PICTURE_SCREEN)).toBe(pictureInput)

      navigate(PLAIN_SCREEN)
      const plainInput = await waitForFocusedInput(setup, PLAIN_SCREEN)
      expect(pictureInput.isDestroyed).toBe(true)
      expect(mediaRenderer.isDestroyed).toBe(true)
      expect(plainInput.focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })

  test('allows nested component code to call navigate directly', async () => {
    function NestedNavigation() {
      onMount(() => navigate(PICTURE_SCREEN))
      return null
    }

    const setup = await testRender(
      () => (
        <box width="100%" height="100%">
          <App />
          <NestedNavigation />
        </box>
      ),
      TEST_SIZE,
    )
    try {
      expect((await waitForFocusedInput(setup, PICTURE_SCREEN)).focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })

  test('parses raw stdin across all screens and leaves Tab to the input', async () => {
    const setup = await testRender(() => <App />, TEST_SIZE)
    try {
      const firstAnimationInput = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await setup.mockInput.typeText('animation')
      setup.mockInput.pressArrow('right')
      await setup.flush()
      expect(firstAnimationInput.value).toBe('animation')
      expect(setup.captureCharFrame()).toContain('VALUE: 1')

      setup.mockInput.pressTab()
      await setup.mockInput.typeText('x')
      await setup.flush()
      expect(findInput(setup, ANIMATION_SCREEN)).toBe(firstAnimationInput)
      expect(firstAnimationInput.focused).toBe(true)
      expect(firstAnimationInput.value).toBe('animationx')

      setup.mockInput.pressArrow('down', { shift: true })
      await setup.flush()
      expect(findInput(setup, ANIMATION_SCREEN)).toBe(firstAnimationInput)

      setup.renderer.stdin.emit('data', Buffer.from('\u001bOB'))
      const pictureInput = await waitForFocusedInput(setup, PICTURE_SCREEN)
      expect(firstAnimationInput.isDestroyed).toBe(true)
      expect(pictureInput.focused).toBe(true)

      setup.renderer.stdin.emit('data', Buffer.from('\u001b[B'))
      const plainInput = await waitForFocusedInput(setup, PLAIN_SCREEN)
      expect(pictureInput.isDestroyed).toBe(true)
      expect(plainInput.focused).toBe(true)

      setup.renderer.stdin.emit('data', Buffer.from('\u001bOB'))
      const secondAnimationInput = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      expect(plainInput.isDestroyed).toBe(true)
      expect(secondAnimationInput.focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })

  test('runs every default keyboard transition through raw CSI and SS3 input', async () => {
    const transitions: readonly [ScreenKey, ScreenKey, string][] = [
      [ANIMATION_SCREEN, PICTURE_SCREEN, '\u001b[B'],
      [ANIMATION_SCREEN, PLAIN_SCREEN, '\u001bOA'],
      [PICTURE_SCREEN, ANIMATION_SCREEN, '\u001b[A'],
      [PICTURE_SCREEN, PLAIN_SCREEN, '\u001bOB'],
      [PLAIN_SCREEN, PICTURE_SCREEN, '\u001b[A'],
      [PLAIN_SCREEN, ANIMATION_SCREEN, '\u001bOB'],
    ]
    const setup = await testRender(() => <App />, TEST_SIZE)

    try {
      for (const [from, to, bytes] of transitions) {
        navigate(from)
        const sourceInput = await waitForFocusedInput(setup, from)
        setup.renderer.stdin.emit('data', Buffer.from(bytes))
        const destinationInput = await waitForFocusedInput(setup, to)
        expect(sourceInput.isDestroyed).toBe(true)
        expect(destinationInput.focused).toBe(true)
        expect(setup.captureCharFrame()).toContain('VALUE: 0')
      }
    } finally {
      setup.renderer.destroy()
    }
  })

  test('keeps one global keyboard listener through fifty complete three-screen cycles', async () => {
    const setup = await testRender(() => <App />, TEST_SIZE)
    try {
      let current = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      const listenerCount = setup.renderer.keyInput.listenerCount('keypress')

      for (let cycle = 0; cycle < 50; cycle += 1) {
        setup.mockInput.pressArrow('down')
        const picture = await waitForFocusedInput(setup, PICTURE_SCREEN)
        expect(current.isDestroyed).toBe(true)
        expect(picture.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)

        setup.mockInput.pressArrow('down')
        const plain = await waitForFocusedInput(setup, PLAIN_SCREEN)
        expect(picture.isDestroyed).toBe(true)
        expect(plain.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)

        setup.mockInput.pressArrow('down')
        const animation = await waitForFocusedInput(setup, ANIMATION_SCREEN)
        expect(plain.isDestroyed).toBe(true)
        expect(animation.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)
        current = animation
      }
    } finally {
      setup.renderer.destroy()
    }
  })

  test('persists global counter and input while focus re-establishes after disposal', async () => {
    const setup = await testRender(() => <App />, TEST_SIZE)
    try {
      const firstAnimation = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await setup.mockInput.typeText('animation-state')
      setup.mockInput.pressArrow('left')
      await setup.flush()
      expect(firstAnimation.value).toBe('animation-state')
      expect(setup.captureCharFrame()).toContain('VALUE: -1')

      setup.mockInput.pressArrow('down')
      const firstPicture = await waitForFocusedInput(setup, PICTURE_SCREEN)
      expect(firstPicture.value).toBe('animation-state')
      await setup.mockInput.typeText('picture-state')
      setup.mockInput.pressArrow('right')
      setup.mockInput.pressArrow('right')
      await setup.flush()
      expect(firstPicture.value).toBe('animation-statepicture-state')
      expect(setup.captureCharFrame()).toContain('VALUE: 1')

      setup.mockInput.pressArrow('down')
      const firstPlain = await waitForFocusedInput(setup, PLAIN_SCREEN)
      expect(firstPlain.value).toBe('animation-statepicture-state')
      await setup.mockInput.typeText('plain-state')
      setup.mockInput.pressArrow('left')
      setup.mockInput.pressArrow('left')
      await setup.flush()
      expect(firstPlain.value).toBe('animation-statepicture-stateplain-state')
      expect(setup.captureCharFrame()).toContain('VALUE: -1')

      setup.mockInput.pressArrow('down')
      const secondAnimation = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await setup.flush()
      expect(secondAnimation).not.toBe(firstAnimation)
      expect(secondAnimation.value).toBe('animation-statepicture-stateplain-state')
      expect(setup.captureCharFrame()).toContain('VALUE: -1')

      setup.mockInput.pressArrow('down')
      const secondPicture = await waitForFocusedInput(setup, PICTURE_SCREEN)
      await setup.flush()
      expect(secondPicture).not.toBe(firstPicture)
      expect(secondPicture.value).toBe('animation-statepicture-stateplain-state')
      expect(setup.captureCharFrame()).toContain('VALUE: -1')

      setup.mockInput.pressArrow('down')
      const secondPlain = await waitForFocusedInput(setup, PLAIN_SCREEN)
      await setup.flush()
      expect(secondPlain).not.toBe(firstPlain)
      expect(secondPlain.value).toBe('animation-statepicture-stateplain-state')
      expect(setup.captureCharFrame()).toContain('VALUE: -1')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('stops all native media on Plain and starts fresh media after either return path', async () => {
    const draw = spyOn(OptimizedBuffer.prototype, 'drawSuperSampleBuffer')
    const setup = await testRender(() => <App />, TEST_SIZE)
    const waitForDrawCount = async (minimum: number) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await setup.flush()
        if (draw.mock.calls.length >= minimum) return
        await Bun.sleep(10)
      }
      expect(draw.mock.calls.length).toBeGreaterThanOrEqual(minimum)
    }

    try {
      await waitForDrawCount(2)
      setup.mockInput.pressArrow('down')
      await waitForFocusedInput(setup, PICTURE_SCREEN)
      const animationDraws = draw.mock.calls.length
      await waitForDrawCount(animationDraws + 1)

      setup.mockInput.pressArrow('down')
      await waitForFocusedInput(setup, PLAIN_SCREEN)
      await setup.waitForVisualIdle()

      const stoppedDraws = draw.mock.calls.length
      await Bun.sleep(250)
      expect(draw.mock.calls).toHaveLength(stoppedDraws)

      setup.mockInput.pressArrow('up')
      await waitForFocusedInput(setup, PICTURE_SCREEN)
      await waitForDrawCount(stoppedDraws + 1)

      setup.mockInput.pressArrow('up')
      await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await waitForDrawCount(stoppedDraws + 2)
    } finally {
      setup.renderer.destroy()
      draw.mockRestore()
    }
  })

  test('keeps focused controls above a component-local decode error', async () => {
    const setup = await testRender(
      () => (
        <PixelRenderer uri="https://example.test/not-local.png" width="100%" height="100%">
          <AppStatePanel label="ANIMATION SCREEN" />
        </PixelRenderer>
      ),
      TEST_SIZE,
    )
    try {
      const input = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await setup.mockInput.typeText('still-alive')
      const frame = await setup.waitForFrame(
        (candidate) => candidate.includes('local files only') && candidate.includes('still-alive'),
      )
      expect(frame).toContain('ANIMATION SCREEN')
      expect(frame).toContain('local files only')
      expect(input.focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })
})
