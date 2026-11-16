import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guards the composition rule that later layers must not break: Exo depends on
// the published workbench kit only through its public entry points, and never
// imports upstream demo views, mock workspace data or vendored preset source.
const srcRoot = join(process.cwd(), 'src')

const ALLOWED_KIT_SPECIFIERS = [
  /^vscode-workbench$/,
  /^vscode-workbench\/react$/,
  /^vscode-workbench\/core$/,
  /^vscode-workbench\/elements\/[\w-]+$/,
  /^vscode-workbench\/styles\/[\w-]+\.css$/,
]

const BANNED_MARKERS = ['apps/template/src/demo', 'mock-workspace', 'mockWorkspace']

const IMPORT_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [path]
  })
}

function importSpecifiers(source: string): string[] {
  const found: string[] = []
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      found.push(match[1])
    }
  }
  return found
}

describe('composition guard', () => {
  const files = sourceFiles(srcRoot)

  it('finds shell sources to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('imports the kit only through public entry points', () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return importSpecifiers(source)
        .filter((specifier) => specifier.startsWith('vscode-workbench/'))
        .filter((specifier) => !ALLOWED_KIT_SPECIFIERS.some((allowed) => allowed.test(specifier)))
        .map((specifier) => `${relative(srcRoot, file)}: ${specifier}`)
    })

    expect(violations).toEqual([])
  })

  it('never references upstream demo, mock or vendored source', () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return BANNED_MARKERS.filter((marker) => source.includes(marker)).map(
        (marker) => `${relative(srcRoot, file)}: ${marker}`,
      )
    })

    expect(violations).toEqual([])
  })

  it('never imports the plugin SDK in production source', () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return importSpecifiers(source)
        .filter(
          (specifier) =>
            specifier === '@exo/plugin-sdk' || specifier.startsWith('@exo/plugin-sdk/'),
        )
        .map((specifier) => `${relative(srcRoot, file)}: ${specifier}`)
    })

    expect(violations).toEqual([])
  })

  it('never imports Monaco or the reference code plugin', () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const imports = importSpecifiers(source)
        .filter(
          (specifier) =>
            specifier === 'monaco-editor' ||
            specifier.startsWith('monaco-editor/') ||
            specifier === '@exo/code-plugin' ||
            specifier.startsWith('@exo/code-plugin/'),
        )
        .map((specifier) => `${relative(srcRoot, file)}: ${specifier}`)
      return source.includes('MonacoEnvironment')
        ? [...imports, `${relative(srcRoot, file)}: MonacoEnvironment`]
        : imports
    })

    expect(violations).toEqual([])
  })
})
