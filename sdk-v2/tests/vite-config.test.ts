import { describe, expect, test } from 'bun:test'
import viteConfig from '../vite.config'

describe('Vite production configuration', () => {
  test('does not re-minify xterm', () => {
    expect(viteConfig.build?.minify).toBe(false)
  })
})
