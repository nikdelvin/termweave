import { describe, expect, test } from 'bun:test'
import type { PixelRendererProps, ScreenNavigation, TermweaveConfig } from '#termweave'

describe('Termweave public API', () => {
  test('has exactly the required runtime export surface and narrow public configuration', async () => {
    const termweave = await import('#termweave')
    expect(Object.keys(termweave).sort()).toEqual([
      'PixelRenderer',
      'bundledMediaUri',
      'createScreenNavigation',
      'getTermweaveConfig',
    ])

    const props = {
      uri: '/tmp/example.png',
      width: '100%',
      height: 10,
    } satisfies PixelRendererProps
    const config: Readonly<TermweaveConfig> = termweave.getTermweaveConfig()
    const navigation: ScreenNavigation<'one' | 'two'> = termweave.createScreenNavigation('one')
    expect(props.uri).toBe('/tmp/example.png')
    expect(termweave.bundledMediaUri('clips/demo 世界.mp4')).toBe(
      'media:clips/demo%20%E4%B8%96%E7%95%8C.mp4',
    )
    expect(config).toEqual({
      themeColor: '#010416',
      terminalForegroundColor: '#F59B5A',
    })
    expect(Object.keys(config).sort()).toEqual(['terminalForegroundColor', 'themeColor'])
    navigation.navigate('two')
    expect(navigation.screen()).toBe('two')
  })
})
