import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanDistForSdk } from '../../scripts/check-dist-no-sdk.mjs'

let created: string[] = []

afterEach(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
  created = []
})

function makeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'exo-no-sdk-'))
  created.push(dir)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  return dir
}

describe('shell bundle SDK guard', () => {
  it('accepts a shell bundle without SDK markers', () => {
    const dist = makeDist()
    writeFileSync(join(dist, 'assets', 'index.js'), 'console.log("shell")')
    expect(scanDistForSdk(dist)).toEqual([])
  })

  it('reports an SDK marker in a shell asset', () => {
    const dist = makeDist()
    writeFileSync(join(dist, 'assets', 'index.js'), 'class ExoProtocolError extends Error {}')
    expect(scanDistForSdk(dist)).toEqual([
      { path: join(dist, 'assets', 'index.js'), marker: 'ExoProtocolError' },
    ])
  })

  it('ignores the deployed template child path', () => {
    const dist = makeDist()
    mkdirSync(join(dist, 'plugin-template', 'assets'), { recursive: true })
    writeFileSync(
      join(dist, 'plugin-template', 'assets', 'plugin.js'),
      'console.log("EXO_TEMPLATE_REGISTER")',
    )
    expect(scanDistForSdk(dist)).toEqual([])
  })

  it('ignores the deployed code plugin child path', () => {
    const dist = makeDist()
    mkdirSync(join(dist, 'code-plugin', 'assets'), { recursive: true })
    writeFileSync(
      join(dist, 'code-plugin', 'assets', 'editor.js'),
      'console.log("ExoProtocolError")',
    )
    expect(scanDistForSdk(dist)).toEqual([])
  })

  it('fails clearly when the build is missing', () => {
    expect(() => scanDistForSdk(join(makeDist(), 'missing'))).toThrow(/not found/)
  })
})
