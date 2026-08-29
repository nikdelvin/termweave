import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { InputRenderable, OptimizedBuffer } from '@opentui/core'
import type { TestRendererSetup } from '@opentui/core/testing'
import { testRender } from '@opentui/solid'
import { onMount } from 'solid-js'
import { App } from '../app/App'
import { navigate, resetAppState } from '../app/store'
import { AppStatePanel, appStateInputId } from '../app/components/AppStatePanel'
import { screenMedia, screens, type ScreenKey } from '../app/screens'
import { remoteVideoScreenMediaUri } from '../app/screens/RemoteVideoScreen'
import { PixelRenderer } from '../termweave/components/PixelRenderer'

const TEST_SIZE = { width: 320, height: 180 }
const ANIMATION_SCREEN: ScreenKey = 'animation'
const PICTURE_SCREEN: ScreenKey = 'picture'
const VIDEO_SCREEN: ScreenKey = 'video'

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
  test('registers the verified HTTPS MP4 for the remote-video screen', () => {
    const uri = new URL(remoteVideoScreenMediaUri)

    expect(uri.protocol).toBe('https:')
    expect(uri.pathname).toEndWith('.mp4')
    expect(screenMedia[VIDEO_SCREEN]).toBe(remoteVideoScreenMediaUri)
  })

  test('renders and focuses all supported initial screens', async () => {
    for (const [screen, present, absent] of [
      [ANIMATION_SCREEN, 'ANIMATION SCREEN', ['PICTURE SCREEN', 'REMOTE VIDEO']],
      [PICTURE_SCREEN, 'PICTURE SCREEN', ['ANIMATION SCREEN', 'REMOTE VIDEO']],
      [VIDEO_SCREEN, 'REMOTE VIDEO', ['ANIMATION SCREEN', 'PICTURE SCREEN']],
    ] as const) {
      navigate(screen)
      let setup: TestRendererSetup | undefined
      try {
        setup = await testRender(() => <App />, TEST_SIZE)
        const frame = await setup.waitForFrame((candidate) => candidate.includes(present))
        for (const marker of absent) expect(frame).not.toContain(marker)
        expect((await waitForFocusedInput(setup, screen)).focused).toBe(true)
      } catch (error) {
        throw new Error(`Failed to render the ${screen} screen.`, { cause: error })
      } finally {
        setup?.renderer.destroy()
      }
    }
  })

  test('registers every screen once and follows direct navigate calls while mounted', async () => {
    expect(Object.keys(screens).sort()).toEqual(
      [ANIMATION_SCREEN, PICTURE_SCREEN, VIDEO_SCREEN].sort(),
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

      navigate(VIDEO_SCREEN)
      const videoInput = await waitForFocusedInput(setup, VIDEO_SCREEN)
      expect(pictureInput.isDestroyed).toBe(true)
      expect(mediaRenderer.isDestroyed).toBe(false)
      expect(appRoot.getChildrenSortedByPrimaryAxis()[0]).toBe(mediaRenderer)
      expect(videoInput.focused).toBe(true)
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
      await setup.flush()
      expect(firstAnimationInput.value).toBe('animation')

      setup.mockInput.pressTab()
      await setup.mockInput.typeText('x')
      await setup.flush()
      expect(findInput(setup, ANIMATION_SCREEN)).toBe(firstAnimationInput)
      expect(firstAnimationInput.focused).toBe(true)
      expect(firstAnimationInput.value).toBe('animationx')

      setup.mockInput.pressArrow('right', { shift: true })
      await setup.flush()
      expect(findInput(setup, ANIMATION_SCREEN)).toBe(firstAnimationInput)

      setup.renderer.stdin.emit('data', Buffer.from('\u001bOC'))
      const pictureInput = await waitForFocusedInput(setup, PICTURE_SCREEN)
      expect(firstAnimationInput.isDestroyed).toBe(true)
      expect(pictureInput.focused).toBe(true)

      setup.renderer.stdin.emit('data', Buffer.from('\u001b[C'))
      const videoInput = await waitForFocusedInput(setup, VIDEO_SCREEN)
      expect(pictureInput.isDestroyed).toBe(true)
      expect(videoInput.focused).toBe(true)

      setup.renderer.stdin.emit('data', Buffer.from('\u001bOC'))
      const secondAnimationInput = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      expect(videoInput.isDestroyed).toBe(true)
      expect(secondAnimationInput.focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })

  test('runs every default keyboard transition through raw CSI and SS3 input', async () => {
    const transitions: readonly [ScreenKey, ScreenKey, string][] = [
      [ANIMATION_SCREEN, PICTURE_SCREEN, '\u001b[C'],
      [ANIMATION_SCREEN, VIDEO_SCREEN, '\u001bOD'],
      [PICTURE_SCREEN, ANIMATION_SCREEN, '\u001b[D'],
      [PICTURE_SCREEN, VIDEO_SCREEN, '\u001bOC'],
      [VIDEO_SCREEN, PICTURE_SCREEN, '\u001b[D'],
      [VIDEO_SCREEN, ANIMATION_SCREEN, '\u001bOC'],
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
        setup.mockInput.pressArrow('right')
        const picture = await waitForFocusedInput(setup, PICTURE_SCREEN)
        expect(current.isDestroyed).toBe(true)
        expect(picture.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)

        setup.mockInput.pressArrow('right')
        const video = await waitForFocusedInput(setup, VIDEO_SCREEN)
        expect(picture.isDestroyed).toBe(true)
        expect(video.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)

        setup.mockInput.pressArrow('right')
        const animation = await waitForFocusedInput(setup, ANIMATION_SCREEN)
        expect(video.isDestroyed).toBe(true)
        expect(animation.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)
        current = animation
      }
    } finally {
      setup.renderer.destroy()
    }
  })

  test('persists global input while focus re-establishes after disposal', async () => {
    const setup = await testRender(() => <App />, TEST_SIZE)
    try {
      const firstAnimation = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await setup.mockInput.typeText('animation-state')
      await setup.flush()
      expect(firstAnimation.value).toBe('animation-state')

      setup.mockInput.pressArrow('right')
      const firstPicture = await waitForFocusedInput(setup, PICTURE_SCREEN)
      expect(firstPicture.value).toBe('animation-state')
      await setup.mockInput.typeText('picture-state')
      await setup.flush()
      expect(firstPicture.value).toBe('animation-statepicture-state')

      setup.mockInput.pressArrow('right')
      const firstVideo = await waitForFocusedInput(setup, VIDEO_SCREEN)
      expect(firstVideo.value).toBe('animation-statepicture-state')
      await setup.mockInput.typeText('video-state')
      await setup.flush()
      expect(firstVideo.value).toBe('animation-statepicture-statevideo-state')

      setup.mockInput.pressArrow('right')
      const secondAnimation = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await setup.flush()
      expect(secondAnimation).not.toBe(firstAnimation)
      expect(secondAnimation.value).toBe('animation-statepicture-statevideo-state')

      setup.mockInput.pressArrow('right')
      const secondPicture = await waitForFocusedInput(setup, PICTURE_SCREEN)
      await setup.flush()
      expect(secondPicture).not.toBe(firstPicture)
      expect(secondPicture.value).toBe('animation-statepicture-statevideo-state')

      setup.mockInput.pressArrow('right')
      const secondVideo = await waitForFocusedInput(setup, VIDEO_SCREEN)
      await setup.flush()
      expect(secondVideo).not.toBe(firstVideo)
      expect(secondVideo.value).toBe('animation-statepicture-statevideo-state')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('keeps one PixelRenderer while moving across all three media screens', async () => {
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
      setup.mockInput.pressArrow('right')
      await waitForFocusedInput(setup, PICTURE_SCREEN)
      const animationDraws = draw.mock.calls.length
      await waitForDrawCount(animationDraws + 1)

      setup.mockInput.pressArrow('right')
      await waitForFocusedInput(setup, VIDEO_SCREEN)
      const videoDraws = draw.mock.calls.length

      setup.mockInput.pressArrow('left')
      await waitForFocusedInput(setup, PICTURE_SCREEN)
      await waitForDrawCount(videoDraws + 1)

      setup.mockInput.pressArrow('left')
      await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await waitForDrawCount(videoDraws + 2)
    } finally {
      setup.renderer.destroy()
      draw.mockRestore()
    }
  })

  test('keeps focused controls above a component-local media error', async () => {
    const setup = await testRender(
      () => (
        <PixelRenderer uri="https://example.test/not-local.png" width="100%" height="100%">
          <AppStatePanel />
        </PixelRenderer>
      ),
      TEST_SIZE,
    )
    try {
      const input = await waitForFocusedInput(setup, ANIMATION_SCREEN)
      await setup.mockInput.typeText('still-alive')
      await Bun.sleep(20)
      const frame = await setup.waitForFrame(
        (candidate) => candidate.includes('preparation step') && candidate.includes('still-alive'),
      )
      expect(frame).toContain('SCREEN ID: animation')
      expect(frame).toContain('preparation step')
      expect(input.focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })
})
