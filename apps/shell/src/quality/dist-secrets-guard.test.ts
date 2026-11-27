import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanDistForSecrets } from '../../scripts/check-dist-secrets.mjs'

let created: string[] = []

afterEach(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
  created = []
})

function makeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'exo-secrets-'))
  created.push(dir)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  return dir
}

describe('deployed artifact secret guard', () => {
  it('accepts a build without credential patterns', () => {
    const dist = makeDist()
    writeFileSync(join(dist, 'assets', 'index.js'), 'console.log("shell")')
    writeFileSync(join(dist, 'index.html'), '<html><body>Exo</body></html>')
    expect(scanDistForSecrets(dist, {})).toEqual([])
  })

  it('reports GitHub, AWS and JWT shaped credentials', () => {
    const dist = makeDist()
    writeFileSync(
      join(dist, 'assets', 'leak.js'),
      [
        `const a = "ghp_${'a'.repeat(36)}"`,
        `const b = "AKIA${'B'.repeat(16)}"`,
        'const c = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456"',
      ].join('\n'),
    )
    expect(scanDistForSecrets(dist, {})).toEqual([
      { path: join(dist, 'assets', 'leak.js'), pattern: 'github-token' },
      { path: join(dist, 'assets', 'leak.js'), pattern: 'aws-access-key' },
      { path: join(dist, 'assets', 'leak.js'), pattern: 'jwt' },
    ])
  })

  it('reports a private key block', () => {
    const dist = makeDist()
    writeFileSync(join(dist, 'assets', 'key.js'), '-----BEGIN PRIVATE KEY-----\nMIIB\n')
    expect(scanDistForSecrets(dist, {})).toEqual([
      { path: join(dist, 'assets', 'key.js'), pattern: 'private-key' },
    ])
  })

  it('scans the deployed plugin child paths', () => {
    const dist = makeDist()
    mkdirSync(join(dist, 'code-plugin', 'assets'), { recursive: true })
    writeFileSync(
      join(dist, 'code-plugin', 'assets', 'editor.js'),
      `const token = "ghp_${'c'.repeat(36)}"`,
    )
    expect(scanDistForSecrets(dist, {})).toEqual([
      { path: join(dist, 'code-plugin', 'assets', 'editor.js'), pattern: 'github-token' },
    ])
  })

  it('scans marketplace assets', () => {
    const dist = makeDist()
    writeFileSync(
      join(dist, 'marketplace.json'),
      `{"plugins":[{"manifest":"https://example.com/exo-manifest.json","token":"ghp_${'e'.repeat(36)}"}]}`,
    )
    expect(scanDistForSecrets(dist, {})).toEqual([
      { path: join(dist, 'marketplace.json'), pattern: 'github-token' },
    ])
  })

  it('reports a secret environment value without printing it', () => {
    const dist = makeDist()
    writeFileSync(join(dist, 'assets', 'config.js'), 'const hidden = "super-secret-value-123"')
    expect(scanDistForSecrets(dist, { EXO_TEST_TOKEN: 'super-secret-value-123' })).toEqual([
      { path: join(dist, 'assets', 'config.js'), pattern: 'env:EXO_TEST_TOKEN' },
    ])
  })

  it('ignores binary assets and reports a symlink', () => {
    const dist = makeDist()
    writeFileSync(join(dist, 'assets', 'font.woff2'), `ghp_${'d'.repeat(36)}`)
    symlinkSync(join(dist, 'assets', 'font.woff2'), join(dist, 'assets', 'link.js'))
    expect(scanDistForSecrets(dist, {})).toEqual([
      { path: join(dist, 'assets', 'link.js'), pattern: 'symlink' },
    ])
  })

  it('fails clearly when the build is missing', () => {
    expect(() => scanDistForSecrets(join(makeDist(), 'missing'), {})).toThrow(/not found/)
  })
})
