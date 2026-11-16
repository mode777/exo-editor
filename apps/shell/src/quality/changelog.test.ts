import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHELL_VERSION } from '../version'
import { PROTOCOL_VERSION } from '../plugins/protocol'
import { MANIFEST_SCHEMA_VERSION } from '../plugins/manifest'

function repoRoot(): string {
  let directory = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(directory, 'CHANGELOG.md'))) return directory
    directory = dirname(directory)
  }
  throw new Error('Could not find CHANGELOG.md.')
}

function sdkVersion(root: string): string {
  const parsed = JSON.parse(
    readFileSync(join(root, 'packages/plugin-sdk/package.json'), 'utf8'),
  ) as { version?: string }
  if (!parsed.version) throw new Error('The SDK package has no version.')
  return parsed.version
}

describe('changelog release entry', () => {
  const root = repoRoot()
  const source = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const first = source.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/m)
  const section = first ? source.slice(first.index) : ''

  it('has a dated release heading', () => {
    expect(first).not.toBeNull()
    expect(first?.[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('matches the shipped shell, protocol, schema and SDK versions', () => {
    expect(first?.[1]).toBe(SHELL_VERSION)
    expect(section).toContain(`Shell: \`${SHELL_VERSION}\``)
    expect(section).toContain(`Protocol: \`${PROTOCOL_VERSION}\``)
    expect(section).toContain(`Manifest schema: \`${MANIFEST_SCHEMA_VERSION}\``)
    expect(section).toContain(`SDK: \`${sdkVersion(root)}\``)
  })

  it('states whether the release has breaking changes', () => {
    expect(section).toContain('### Breaking')
    expect(section).toMatch(/None\.|^- /m)
  })
})
