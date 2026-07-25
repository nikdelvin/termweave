import { describe, expect, test } from 'bun:test'
import { parseBunAuditOutput } from '../../../scripts/packages/audit-packages'

const braceExpansionAdvisory = {
  id: 1124334,
  severity: 'high',
  title: 'brace-expansion denial of service',
  url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
  vulnerable_versions: '<=5.0.7',
}

describe('package vulnerability audit policy', () => {
  test('allows every advisory reported for brace-expansion', () => {
    expect(
      parseBunAuditOutput(
        JSON.stringify({
          'brace-expansion': [
            braceExpansionAdvisory,
            { ...braceExpansionAdvisory, id: 2, url: 'https://example.com/future-advisory' },
          ],
        }),
      ),
    ).toEqual([
      {
        packageName: 'brace-expansion',
        advisories: [
          braceExpansionAdvisory,
          { ...braceExpansionAdvisory, id: 2, url: 'https://example.com/future-advisory' },
        ],
      },
    ])
  })

  test('rejects any vulnerable package outside the package-scoped allowlist', () => {
    expect(() =>
      parseBunAuditOutput(
        JSON.stringify({
          'brace-expansion': [braceExpansionAdvisory],
          'unexpected-package': [{ id: 1, severity: 'critical' }],
        }),
      ),
    ).toThrow('non-allowlisted vulnerable packages: unexpected-package')
  })

  test('accepts an empty report and rejects malformed reports', () => {
    expect(parseBunAuditOutput('{}')).toEqual([])
    expect(() => parseBunAuditOutput('not JSON')).toThrow('malformed JSON')
    expect(() => parseBunAuditOutput('[]')).toThrow('must be a JSON object')
    expect(() => parseBunAuditOutput('{"brace-expansion":{}}')).toThrow(
      'must be an array of advisory objects',
    )
  })
})
