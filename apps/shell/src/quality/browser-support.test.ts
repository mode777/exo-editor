import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

function docFile(name: string): string {
  let directory = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'docs', name)
    if (existsSync(candidate)) return candidate
    directory = dirname(directory)
  }
  throw new Error(`Could not find docs/${name}.`)
}

describe('browser support matrix', () => {
  const matrix = readFileSync(docFile('browser-support.md'), 'utf8')

  it('classifies every v1 browser family', () => {
    for (const browser of ['Chromium', 'Firefox', 'Safari', 'Mobile']) {
      expect(matrix).toContain(browser)
    }
  })

  it('keeps Chromium supported for folder and remote workspaces', () => {
    const chromium = matrix.split('\n').find((line) => line.startsWith('| Chromium desktop'))
    expect(chromium).toBeDefined()
    expect(chromium).toContain('| Supported | Supported | Supported |')
  })

  it('does not claim folder support for Firefox or Safari', () => {
    const firefox = matrix.split('\n').find((line) => line.startsWith('| Firefox desktop'))
    const safari = matrix.split('\n').find((line) => line.startsWith('| Safari desktop'))
    expect(firefox).toContain('Unsupported - explicit state')
    expect(safari).toContain('Unsupported - explicit state')
  })

  it('labels unverified remote and plugin combinations', () => {
    const firefox = matrix.split('\n').find((line) => line.startsWith('| Firefox desktop'))
    const safari = matrix.split('\n').find((line) => line.startsWith('| Safari desktop'))
    expect(firefox).toContain('plugin host unverified')
    expect(safari).toContain('| Unverified | Unverified |')
  })
})
