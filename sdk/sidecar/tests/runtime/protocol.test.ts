import { describe, expect, test } from 'bun:test'
import { parseClientMessage, tokenMatches } from '../../src/runtime/protocol'

describe('sidecar client protocol', () => {
  test('parses every supported client message', () => {
    expect(parseClientMessage('{"type":"authenticate","token":"secret"}')).toEqual({
      type: 'authenticate',
      token: 'secret',
    })
    expect(parseClientMessage('{"type":"input","data":"hello"}')).toEqual({
      type: 'input',
      data: 'hello',
    })
    expect(parseClientMessage('{"type":"frame-ack","frameId":42}')).toEqual({
      type: 'frame-ack',
      frameId: 42,
    })
    expect(parseClientMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    })
    expect(parseClientMessage('{"type":"shutdown"}')).toEqual({ type: 'shutdown' })
  })

  test('ignores malformed and unsupported messages', () => {
    expect(parseClientMessage('invalid JSON')).toBeUndefined()
    expect(parseClientMessage('null')).toBeUndefined()
    expect(parseClientMessage('{"type":"frame-ack","frameId":0}')).toBeUndefined()
    expect(parseClientMessage('{"type":"resize","cols":null,"rows":40}')).toBeUndefined()
    expect(parseClientMessage('{"type":"unknown"}')).toBeUndefined()
  })

  test('matches only the exact client token', () => {
    expect(tokenMatches('secret', 'secret')).toBeTrue()
    expect(tokenMatches('secret', 'SECRET')).toBeFalse()
    expect(tokenMatches('secret', 'secret-longer')).toBeFalse()
  })
})
