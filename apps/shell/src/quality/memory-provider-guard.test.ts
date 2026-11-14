import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The memory provider is the test oracle. It must never be mounted as a fake
// workspace in the app, so no production source file may import it.
const srcRoot = join(process.cwd(), 'src')
const memoryProvider = join('workspace', 'providers', 'memory')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [path]
  })
}

describe('memory provider guard', () => {
  it('is not imported by production source', () => {
    const violations = sourceFiles(srcRoot).flatMap((file) => {
      if (file.endsWith(memoryProvider + '.ts')) return []
      const source = readFileSync(file, 'utf8')
      return source.includes('providers/memory') ? [file] : []
    })

    expect(violations).toEqual([])
  })
})
