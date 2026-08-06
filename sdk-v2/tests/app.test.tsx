import { describe, expect, spyOn, test } from 'bun:test'
import { InputRenderable, OptimizedBuffer } from '@opentui/core'
import type { TestRendererSetup } from '@opentui/core/testing'
import { testRender } from '@opentui/solid'
import { App } from '../app/App'
import { ScreenControls, screenInputId } from '../app/components/ScreenControls'
import { GALLERY_SCREEN, HOME_SCREEN, PLAIN_SCREEN, type ScreenId } from '../app/screen-state'
import { PixelRenderer } from '../app/termweave/PixelRenderer'

const TEST_SIZE = { width: 320, height: 180 }

function findInput(setup: TestRendererSetup, screen: ScreenId) {
  return setup.renderer.root.findDescendantById(screenInputId(screen)) as
    InputRenderable | undefined
}

async function waitForFocusedInput(setup: TestRendererSetup, screen: ScreenId) {
  await setup.waitFor(() => findInput(setup, screen)?.focused === true)
  return findInput(setup, screen)!
}

describe('native Solid screens', () => {
  test('renders and focuses all supported initial screens', async () => {
    for (const [screen, present, absent] of [
      [HOME_SCREEN, 'HOME SCREEN', ['GALLERY SCREEN', 'PLAIN SCREEN']],
      [GALLERY_SCREEN, 'GALLERY SCREEN', ['HOME SCREEN', 'PLAIN SCREEN']],
      [PLAIN_SCREEN, 'PLAIN SCREEN', ['HOME SCREEN', 'GALLERY SCREEN']],
    ] as const) {
      const setup = await testRender(() => <App initialScreen={screen} />, TEST_SIZE)
      try {
        const frame = await setup.waitForFrame((candidate) => candidate.includes(present))
        for (const marker of absent) expect(frame).not.toContain(marker)
        expect((await waitForFocusedInput(setup, screen)).focused).toBe(true)
      } finally {
        setup.renderer.destroy()
      }
    }
  })

  test('parses raw stdin across all screens and leaves Tab to the input', async () => {
    const setup = await testRender(() => <App />, TEST_SIZE)
    try {
      const firstHomeInput = await waitForFocusedInput(setup, HOME_SCREEN)
      await setup.mockInput.typeText('home')
      setup.mockInput.pressArrow('right')
      await setup.flush()
      expect(firstHomeInput.value).toBe('home')
      expect(setup.captureCharFrame()).toContain('VALUE: 1')

      setup.mockInput.pressTab()
      await setup.mockInput.typeText('x')
      await setup.flush()
      expect(findInput(setup, HOME_SCREEN)).toBe(firstHomeInput)
      expect(firstHomeInput.focused).toBe(true)
      expect(firstHomeInput.value).toBe('homex')

      setup.renderer.stdin.emit('data', Buffer.from('\u001bOB'))
      const galleryInput = await waitForFocusedInput(setup, GALLERY_SCREEN)
      expect(firstHomeInput.isDestroyed).toBe(true)
      expect(galleryInput.focused).toBe(true)

      setup.renderer.stdin.emit('data', Buffer.from('\u001b[B'))
      const plainInput = await waitForFocusedInput(setup, PLAIN_SCREEN)
      expect(galleryInput.isDestroyed).toBe(true)
      expect(plainInput.focused).toBe(true)

      setup.renderer.stdin.emit('data', Buffer.from('\u001bOB'))
      const secondHomeInput = await waitForFocusedInput(setup, HOME_SCREEN)
      expect(plainInput.isDestroyed).toBe(true)
      expect(secondHomeInput.focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })

  test('keeps one global keyboard listener through fifty complete three-screen cycles', async () => {
    const setup = await testRender(() => <App />, TEST_SIZE)
    try {
      let current = await waitForFocusedInput(setup, HOME_SCREEN)
      const listenerCount = setup.renderer.keyInput.listenerCount('keypress')

      for (let cycle = 0; cycle < 50; cycle += 1) {
        setup.mockInput.pressArrow('down')
        const gallery = await waitForFocusedInput(setup, GALLERY_SCREEN)
        expect(current.isDestroyed).toBe(true)
        expect(gallery.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)

        setup.mockInput.pressArrow('down')
        const plain = await waitForFocusedInput(setup, PLAIN_SCREEN)
        expect(gallery.isDestroyed).toBe(true)
        expect(plain.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)

        setup.mockInput.pressArrow('down')
        const home = await waitForFocusedInput(setup, HOME_SCREEN)
        expect(plain.isDestroyed).toBe(true)
        expect(home.focused).toBe(true)
        expect(setup.renderer.keyInput.listenerCount('keypress')).toBe(listenerCount)
        current = home
      }
    } finally {
      setup.renderer.destroy()
    }
  })

  test('resets each screen local counter and typed input after disposal', async () => {
    const setup = await testRender(() => <App />, TEST_SIZE)
    try {
      const firstHome = await waitForFocusedInput(setup, HOME_SCREEN)
      await setup.mockInput.typeText('home-state')
      setup.mockInput.pressArrow('left')
      await setup.flush()
      expect(firstHome.value).toBe('home-state')
      expect(setup.captureCharFrame()).toContain('VALUE: -1')

      setup.mockInput.pressArrow('down')
      const firstGallery = await waitForFocusedInput(setup, GALLERY_SCREEN)
      await setup.mockInput.typeText('gallery-state')
      setup.mockInput.pressArrow('right')
      setup.mockInput.pressArrow('right')
      await setup.flush()
      expect(firstGallery.value).toBe('gallery-state')
      expect(setup.captureCharFrame()).toContain('VALUE: 2')

      setup.mockInput.pressArrow('down')
      const firstPlain = await waitForFocusedInput(setup, PLAIN_SCREEN)
      await setup.mockInput.typeText('plain-state')
      setup.mockInput.pressArrow('left')
      setup.mockInput.pressArrow('left')
      await setup.flush()
      expect(firstPlain.value).toBe('plain-state')
      expect(setup.captureCharFrame()).toContain('VALUE: -2')

      setup.mockInput.pressArrow('down')
      const secondHome = await waitForFocusedInput(setup, HOME_SCREEN)
      await setup.flush()
      expect(secondHome).not.toBe(firstHome)
      expect(secondHome.value).toBe('')
      expect(setup.captureCharFrame()).toContain('VALUE: 0')

      setup.mockInput.pressArrow('down')
      const secondGallery = await waitForFocusedInput(setup, GALLERY_SCREEN)
      await setup.flush()
      expect(secondGallery).not.toBe(firstGallery)
      expect(secondGallery.value).toBe('')
      expect(setup.captureCharFrame()).toContain('VALUE: 0')

      setup.mockInput.pressArrow('down')
      const secondPlain = await waitForFocusedInput(setup, PLAIN_SCREEN)
      await setup.flush()
      expect(secondPlain).not.toBe(firstPlain)
      expect(secondPlain.value).toBe('')
      expect(setup.captureCharFrame()).toContain('VALUE: 0')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('stops all native media on Plain and starts fresh media after either return path', async () => {
    const draw = spyOn(OptimizedBuffer.prototype, 'drawSuperSampleBuffer')
    const setup = await testRender(() => <App />, TEST_SIZE)
    const waitForDrawCount = async (stride: number, minimum: number) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await setup.flush()
        if (draw.mock.calls.filter((call) => call[5] === stride).length >= minimum) return
        await Bun.sleep(10)
      }
      expect(draw.mock.calls.filter((call) => call[5] === stride).length).toBeGreaterThanOrEqual(
        minimum,
      )
    }

    try {
      await waitForDrawCount(2560, 2)
      setup.mockInput.pressArrow('down')
      await waitForFocusedInput(setup, GALLERY_SCREEN)
      await waitForDrawCount(1440, 1)

      setup.mockInput.pressArrow('down')
      await waitForFocusedInput(setup, PLAIN_SCREEN)
      await setup.waitForVisualIdle()

      const stoppedHomeDraws = draw.mock.calls.filter((call) => call[5] === 2560).length
      const stoppedGalleryDraws = draw.mock.calls.filter((call) => call[5] === 1440).length
      await Bun.sleep(250)
      expect(draw.mock.calls.filter((call) => call[5] === 2560)).toHaveLength(stoppedHomeDraws)
      expect(draw.mock.calls.filter((call) => call[5] === 1440)).toHaveLength(stoppedGalleryDraws)

      setup.mockInput.pressArrow('up')
      await waitForFocusedInput(setup, GALLERY_SCREEN)
      await waitForDrawCount(1440, stoppedGalleryDraws + 1)

      setup.mockInput.pressArrow('up')
      await waitForFocusedInput(setup, HOME_SCREEN)
      await waitForDrawCount(2560, stoppedHomeDraws + 1)
    } finally {
      setup.renderer.destroy()
      draw.mockRestore()
    }
  })

  test('keeps focused controls above a component-local decode error', async () => {
    const setup = await testRender(
      () => (
        <PixelRenderer uri="https://example.test/not-local.png" width="100%" height="100%">
          <ScreenControls label="HOME SCREEN" screen={HOME_SCREEN} />
        </PixelRenderer>
      ),
      TEST_SIZE,
    )
    try {
      const input = await waitForFocusedInput(setup, HOME_SCREEN)
      await setup.mockInput.typeText('still-alive')
      const frame = await setup.waitForFrame(
        (candidate) => candidate.includes('PixelRenderer:') && candidate.includes('still-alive'),
      )
      expect(frame).toContain('HOME SCREEN')
      expect(frame).toContain('local files only')
      expect(input.focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })
})
