/**
 * The v1 glob subset from `docs/contracts/plugin-manifest.md`: `*`, `**`, `?`,
 * character classes and brace alternation. Globs are POSIX-style, `/`-separated
 * and matched against a workspace path without its leading slash.
 */

export const GLOB_MAX_LENGTH = 200

export type GlobErrorReason =
  | 'empty'
  | 'too-long'
  | 'leading-slash'
  | 'dot-segment'
  | 'nul'
  | 'backslash'
  | 'negation'
  | 'extglob'
  | 'regex'
  | 'brace'
  | 'class'

export type GlobResult = { ok: true; regex: RegExp } | { ok: false; reason: GlobErrorReason }

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g

function escapeLiteral(value: string): string {
  return value.replace(REGEX_SPECIAL, '\\$&')
}

function isRegexControl(value: string): boolean {
  return value === '(' || value === ')' || value === '|'
}

function parseClass(pattern: string, start: number): { body: string; end: number } | null {
  let index = start + 1
  if (index >= pattern.length) return null
  if (pattern[index] === '!') index += 1
  const bodyStart = index
  while (index < pattern.length && pattern[index] !== ']') {
    if (pattern[index] === '\\' || pattern[index] === '/' || pattern[index] === '[') return null
    index += 1
  }
  if (index >= pattern.length || index === bodyStart) return null
  return { body: pattern.slice(start + 1, index), end: index }
}

function parseBrace(
  pattern: string,
  start: number,
): { alternatives: string[]; end: number } | null {
  const close = pattern.indexOf('}', start + 1)
  if (close === -1) return null
  const body = pattern.slice(start + 1, close)
  if (body.length === 0 || body.includes('{')) return null
  const alternatives = body.split(',')
  if (alternatives.some((value) => value.length === 0)) return null
  for (const value of alternatives) {
    if (/[*?[\]{}()|\\/]/.test(value) || value.includes('\u0000')) return null
  }
  return { alternatives, end: close }
}

/**
 * Validate and compile a glob. Validation is intentionally strict: anything
 * outside the documented subset is rejected instead of being treated as a
 * literal or a partial regex.
 */
export function compileGlob(pattern: unknown): GlobResult {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  if (pattern.length > GLOB_MAX_LENGTH) return { ok: false, reason: 'too-long' }
  if (pattern.startsWith('/')) return { ok: false, reason: 'leading-slash' }
  if (pattern.includes('..')) return { ok: false, reason: 'dot-segment' }
  if (pattern.includes('\u0000')) return { ok: false, reason: 'nul' }
  if (pattern.includes('\\')) return { ok: false, reason: 'backslash' }
  if (pattern.startsWith('!')) return { ok: false, reason: 'negation' }
  if (/(^|[^?*+@])!?\(/.test(pattern) || /[*?+@]\(/.test(pattern)) {
    return { ok: false, reason: 'extglob' }
  }

  let source = '^'
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:[^/]+/)*'
          index += 3
        } else {
          source += '.*'
          index += 2
        }
      } else {
        source += '[^/]*'
        index += 1
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      index += 1
      continue
    }
    if (char === '[') {
      const parsed = parseClass(pattern, index)
      if (!parsed) return { ok: false, reason: 'class' }
      const body = parsed.body.startsWith('!') ? `^${parsed.body.slice(1)}` : parsed.body
      source += `[${body}]`
      index = parsed.end + 1
      continue
    }
    if (char === '{') {
      const parsed = parseBrace(pattern, index)
      if (!parsed) return { ok: false, reason: 'brace' }
      source += `(?:${parsed.alternatives.map(escapeLiteral).join('|')})`
      index = parsed.end + 1
      continue
    }
    if (isRegexControl(char) || char === '}') return { ok: false, reason: 'regex' }
    source += escapeLiteral(char)
    index += 1
  }
  source += '$'
  try {
    return { ok: true, regex: new RegExp(source) }
  } catch {
    return { ok: false, reason: 'regex' }
  }
}

/** Match a workspace path against a compiled glob. */
export function matchGlob(regex: RegExp, path: string): boolean {
  const normalized = path.startsWith('/') ? path.slice(1) : path
  if (normalized.length === 0) return false
  return regex.test(normalized)
}
