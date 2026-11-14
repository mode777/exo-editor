import { describe, expect, it } from 'vitest'
import {
  basename,
  dirname,
  filterReserved,
  isReservedName,
  isReservedPath,
  joinPath,
  normalizePath,
  validateEntryName,
} from './paths'
import type { FileStat } from './contract'

const stat = (path: string): FileStat => ({
  path,
  kind: 'file',
  size: 0,
  mtime: 0,
  version: 'v',
})

describe('path normalization', () => {
  it.each(['/', '/a.txt', '/docs/readme.md', '/a b/c-d_e.ts'])('accepts %s', (path) => {
    expect(normalizePath(path)).toBe(path)
  })

  it.each([
    ['', 'empty'],
    ['relative.txt', 'relative'],
    ['/trailing/', 'trailing slash'],
    ['/double//slash', 'empty segment'],
    ['/a/../b', 'parent traversal'],
    ['/a/./b', 'current directory'],
    ['/back\\slash', 'backslash'],
    ['/nul\0byte', 'NUL'],
    ['/control\u0007char', 'control character'],
    [`/${'x'.repeat(256)}`, 'long segment'],
    [`/${'x/'.repeat(2049)}x`, 'long path'],
  ])('rejects %s (%s)', (path) => {
    expect(() => normalizePath(path)).toThrow(/path|segment|slash|contain/i)
  })

  it('maps every rejection to permission-denied', () => {
    expect(() => normalizePath('../escape')).toThrow(
      expect.objectContaining({ code: 'permission-denied' }),
    )
  })
})

describe('entry names', () => {
  it.each(['file.txt', 'a b', '.hidden', 'dir-name'])('accepts %s', (name) => {
    expect(validateEntryName(name)).toBe(name)
  })

  it.each(['', '.', '..', 'a/b', 'a\\b', 'a\0b', 'a\nb', 'x'.repeat(256)])('rejects %s', (name) => {
    expect(() => validateEntryName(name)).toThrow()
  })
})

describe('path helpers', () => {
  it('joins and splits paths', () => {
    expect(joinPath('/', 'a.txt')).toBe('/a.txt')
    expect(joinPath('/docs', 'a.txt')).toBe('/docs/a.txt')
    expect(dirname('/docs/a.txt')).toBe('/docs')
    expect(dirname('/a.txt')).toBe('/')
    expect(dirname('/')).toBe('/')
    expect(basename('/docs/a.txt')).toBe('a.txt')
  })

  it('rejects a name with a separator instead of joining it', () => {
    expect(() => joinPath('/docs', 'nested/a.txt')).toThrow()
  })
})

describe('reserved paths', () => {
  it('reserves the configuration file and metadata directory', () => {
    expect(isReservedPath('/exo.json')).toBe(true)
    expect(isReservedPath('/.exo')).toBe(true)
    expect(isReservedPath('/.exo/state.json')).toBe(true)
    expect(isReservedPath('/EXO.JSON')).toBe(false)
    expect(isReservedPath('/exo.json5')).toBe(false)
    expect(isReservedPath('/.exo2')).toBe(false)
  })

  it('folds case on a case-insensitive provider', () => {
    expect(isReservedPath('/EXO.JSON', false)).toBe(true)
    expect(isReservedPath('/.EXO/state.json', false)).toBe(true)
  })

  it('reserves entry names without matching similar names', () => {
    expect(isReservedName('exo.json')).toBe(true)
    expect(isReservedName('.exo')).toBe(true)
    expect(isReservedName('EXO.JSON', false)).toBe(true)
    expect(isReservedName('exo.json.bak')).toBe(false)
  })

  it('filters reserved entries out of listings', () => {
    const entries = [stat('/exo.json'), stat('/.exo/state.json'), stat('/.exo2'), stat('/src')]

    expect(filterReserved(entries, true).map((entry) => entry.path)).toEqual(['/.exo2', '/src'])
    expect(filterReserved([stat('/EXO.JSON')], false)).toEqual([])
  })
})
