import { describe, expect, it } from 'vitest'
import { compileGlob, matchGlob } from './glob'

function matches(glob: string, path: string): boolean {
  const compiled = compileGlob(glob)
  expect(compiled.ok, `${glob} should compile`).toBe(true)
  return compiled.ok ? matchGlob(compiled.regex, path) : false
}

function rejects(glob: string): void {
  expect(compileGlob(glob).ok, `${JSON.stringify(glob)} should be rejected`).toBe(false)
}

describe('glob compilation', () => {
  it('matches root and nested files with **/', () => {
    expect(matches('**/*.ts', 'a.ts')).toBe(true)
    expect(matches('**/*.ts', 'src/a.ts')).toBe(true)
    expect(matches('**/*.ts', 'src/a/b.ts')).toBe(true)
    expect(matches('**/*.ts', 'a.js')).toBe(false)
  })

  it('anchors a prefix before **', () => {
    expect(matches('src/**/*.ts', 'src/a.ts')).toBe(true)
    expect(matches('src/**/*.ts', 'src/a/b.ts')).toBe(true)
    expect(matches('src/**/*.ts', 'other/a.ts')).toBe(false)
    expect(matches('src/**/*.ts', 'src/a.js')).toBe(false)
  })

  it('keeps a single star inside one segment', () => {
    expect(matches('*.md', 'README.md')).toBe(true)
    expect(matches('*.md', 'docs/README.md')).toBe(false)
    expect(matches('a*c.ts', 'a/bc.ts')).toBe(false)
  })

  it('matches one character with ?', () => {
    expect(matches('a?c.ts', 'abc.ts')).toBe(true)
    expect(matches('a?c.ts', 'ac.ts')).toBe(false)
    expect(matches('a?c.ts', 'a/c.ts')).toBe(false)
  })

  it('matches character classes and negated classes', () => {
    expect(matches('[abc].txt', 'a.txt')).toBe(true)
    expect(matches('[abc].txt', 'd.txt')).toBe(false)
    expect(matches('[!abc].txt', 'd.txt')).toBe(true)
    expect(matches('[!abc].txt', 'a.txt')).toBe(false)
    expect(matches('[a-z].txt', 'm.txt')).toBe(true)
  })

  it('matches brace alternation', () => {
    expect(matches('**/*.{ts,tsx}', 'a.ts')).toBe(true)
    expect(matches('**/*.{ts,tsx}', 'src/a.tsx')).toBe(true)
    expect(matches('**/*.{ts,tsx}', 'src/a.js')).toBe(false)
    expect(matches('file{1,2}.txt', 'file2.txt')).toBe(true)
    expect(matches('file{1,2}.txt', 'file3.txt')).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(matches('*.TXT', 'a.txt')).toBe(false)
    expect(matches('*.txt', 'a.TXT')).toBe(false)
  })

  it('does not match the empty path', () => {
    expect(matches('**/*', '')).toBe(false)
    expect(matches('**/*', '/')).toBe(false)
  })

  it('rejects syntax outside the contract subset', () => {
    for (const glob of [
      '',
      '/absolute/*.ts',
      'a/../b.ts',
      '!a.ts',
      'a\\b.ts',
      '@(a|b).ts',
      'a|b.ts',
      'a(b).ts',
      'a[b.ts',
      '{a,}.ts',
      '{a,{b,c}}.ts',
      `a${'b'.repeat(200)}.ts`,
      'a\u0000b.ts',
    ]) {
      rejects(glob)
    }
  })
})
