import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanDistForMonaco } from '../../scripts/check-dist-no-monaco.mjs'

let created: string[] = []

afterEach(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
  created = []
})

function makeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'exo-no-monaco-'))
  created.push(dir)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  return dir
}

describe('shell bundle Monaco guard', () => {
  it('accepts a shell bundle without Monaco markers', () => {
    const dist = makeDist()
    writeFileSync(join(dist, 'assets', 'index.js'), 'console.log("shell")')
    expect(scanDistForMonaco(dist)).toEqual([])
  })

  it('reports a Monaco marker in a shell asset', () => {
    const dist = makeDist()
    writeFileSync(join(dist, 'assets', 'index.js'), 'globalThis.MonacoEnvironment = {}')
    expect(scanDistForMonaco(dist)).toEqual([
      { path: join(dist, 'assets', 'index.js'), marker: 'MonacoEnvironment' },
    ])
  })

  it('ignores the deployed code plugin child path', () => {
    const dist = makeDist()
    mkdirSync(join(dist, 'code-plugin', 'assets'), { recursive: true })
    writeFileSync(
      join(dist, 'code-plugin', 'assets', 'editor.js'),
      'globalThis.MonacoEnvironment = {}',
    )
    expect(scanDistForMonaco(dist)).toEqual([])
  })

  it('fails clearly when the build is missing', () => {
    expect(() => scanDistForMonaco(join(makeDist(), 'missing'))).toThrow(/not found/)
  })
})
