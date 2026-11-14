import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHELL_VERSION } from './version'

describe('shell version', () => {
  it('matches the package version', () => {
    let directory = process.cwd()
    let version: string | null = null
    for (let depth = 0; depth < 6 && version === null; depth += 1) {
      for (const candidate of [
        join(directory, 'apps/shell/package.json'),
        join(directory, 'package.json'),
      ]) {
        if (!existsSync(candidate)) continue
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as {
          name?: unknown
          version?: unknown
        }
        if (pkg.name === '@exo/shell') {
          version = typeof pkg.version === 'string' ? pkg.version : null
          break
        }
      }
      directory = dirname(directory)
    }
    expect(version).toBe(SHELL_VERSION)
  })

  it('is a stable semver release', () => {
    expect(SHELL_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
