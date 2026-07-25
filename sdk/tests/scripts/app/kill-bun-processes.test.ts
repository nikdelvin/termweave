import { describe, expect, test } from 'bun:test'
import {
  getProtectedProcessIds,
  parseProcessSnapshot,
  selectBunProcessTargets,
} from '../../../scripts/app/kill-bun-processes'

const snapshot = `
  10 1 501 /usr/bin/zsh
  20 10 501 /opt/homebrew/bin/bun
  30 20 501 /opt/homebrew/bin/bun
  40 10 502 /usr/local/bin/bun
  50 10 501 /usr/bin/node
`

describe('Bun process selection', () => {
  test('parses ps output', () => {
    expect(parseProcessSnapshot(snapshot)).toHaveLength(5)
  })

  test('protects the current process and all of its known ancestors', () => {
    const processes = parseProcessSnapshot(snapshot)
    expect([...getProtectedProcessIds(processes, 30, 20)].sort()).toEqual([10, 20, 30])
  })

  test('targets Bun processes outside the command ancestry', () => {
    const targets = selectBunProcessTargets(parseProcessSnapshot(snapshot), 30, 20)
    expect(targets.map(({ pid }) => pid)).toEqual([40])
  })
})
