import { describe, expect, test } from 'bun:test'
import viteConfig from '../vite.config'

describe('Vite production configuration', () => {
  test('does not re-minify xterm', () => {
    expect(viteConfig.build?.minify).toBe(false)
  })

  test('leaves OpenTUI source and configuration reloads to the development launcher', () => {
    expect(viteConfig.server?.watch?.ignored).toEqual([
      '**/src-tauri/**',
      '**/app/**',
      '**/termweave/components/**',
      '**/termweave/index.ts',
      '**/termweave/sidecar.tsx',
    ])
  })
})
