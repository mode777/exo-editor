import { describe, expect, it } from 'vitest'
import { isDirty } from './dirty'
import {
  MAX_MONACO_BYTES,
  canOpenInMonaco,
  formatBytes,
  languageForPath,
  monacoThemeFor,
  tooLargeMessage,
} from './languages'

describe('language selection', () => {
  it('maps the supported extensions', () => {
    expect(languageForPath('/src/a.ts')).toBe('typescript')
    expect(languageForPath('/src/a.tsx')).toBe('typescript')
    expect(languageForPath('/src/a.js')).toBe('javascript')
    expect(languageForPath('/src/a.jsx')).toBe('javascript')
    expect(languageForPath('/src/a.json')).toBe('json')
    expect(languageForPath('/README.md')).toBe('markdown')
  })

  it('falls back to plaintext for anything else', () => {
    expect(languageForPath('/a.txt')).toBe('plaintext')
    expect(languageForPath('/Dockerfile')).toBe('plaintext')
  })
})

describe('theme selection', () => {
  it('maps every shell theme to a Monaco theme', () => {
    expect(monacoThemeFor('dark')).toBe('vs-dark')
    expect(monacoThemeFor('light')).toBe('vs')
    expect(monacoThemeFor('high-contrast')).toBe('hc-black')
  })
})

describe('large-file guard', () => {
  const limits = { maxFileSize: 10 * 1024 * 1024, maxRequestBytes: 16 * 1024 * 1024 }

  it('accepts files up to the Monaco limit and below the shell limits', () => {
    expect(canOpenInMonaco(MAX_MONACO_BYTES, limits)).toBe(true)
    expect(canOpenInMonaco(MAX_MONACO_BYTES + 1, limits)).toBe(false)
  })

  it('respects a lower shell limit', () => {
    expect(canOpenInMonaco(2 * 1024 * 1024, { maxFileSize: 1, maxRequestBytes: 1 })).toBe(false)
  })

  it('explains the refusal with the measured size', () => {
    expect(tooLargeMessage(6 * 1024 * 1024)).toContain('6.0 MiB')
    expect(tooLargeMessage(6 * 1024 * 1024)).toContain('5 MiB')
  })

  it('formats sizes for the status strip', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KiB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB')
  })
})

describe('dirty text comparison', () => {
  it('is clean only while the model equals the saved text', () => {
    expect(isDirty('saved', 'saved')).toBe(false)
    expect(isDirty('saved', 'edited')).toBe(true)
    expect(isDirty('saved', '')).toBe(true)
  })
})
