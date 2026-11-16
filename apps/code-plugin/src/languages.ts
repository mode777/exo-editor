import type { ThemeName } from '@exo/plugin-sdk'

/** Monaco is responsive below this; the shell's own read cap stays higher. */
export const MAX_MONACO_BYTES = 5 * 1024 * 1024

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
}

export function languageForPath(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext'
}

export function monacoThemeFor(theme: ThemeName): string {
  if (theme === 'light') return 'vs'
  if (theme === 'high-contrast') return 'hc-black'
  return 'vs-dark'
}

export function canOpenInMonaco(
  size: number,
  limits: { maxFileSize: number; maxRequestBytes: number },
): boolean {
  return size <= Math.min(MAX_MONACO_BYTES, limits.maxFileSize, limits.maxRequestBytes)
}

export function tooLargeMessage(size: number): string {
  const limit = MAX_MONACO_BYTES / (1024 * 1024)
  return `This file is ${formatBytes(size)}. The code editor refuses files above ${limit} MiB; open it with the shell text editor instead.`
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}
