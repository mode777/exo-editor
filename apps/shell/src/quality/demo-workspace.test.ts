import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseExoConfig } from '../plugins/config'
import { compileGlob, matchGlob } from '../plugins/glob'

function repoRoot(): string {
  let directory = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(directory, 'examples/demo-workspace/exo.json'))) return directory
    directory = dirname(directory)
  }
  throw new Error('Could not find examples/demo-workspace.')
}

const root = repoRoot()
const demo = join(root, 'examples/demo-workspace')

interface EditorContribution {
  glob: string
  label: string
}

function editors(manifestPath: string): EditorContribution[] {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    contributes?: { fileEditors?: EditorContribution[] }
  }
  return manifest.contributes?.fileEditors ?? []
}

function matches(contributions: EditorContribution[], path: string): EditorContribution[] {
  return contributions.filter((contribution) => {
    const compiled = compileGlob(contribution.glob)
    if (!compiled.ok) throw new Error(`Invalid glob ${contribution.glob}`)
    return matchGlob(compiled.regex, path.replace(/^\//, ''))
  })
}

describe('demo workspace', () => {
  const code = editors(join(root, 'apps/code-plugin/public/exo-manifest.json'))
  const template = editors(join(root, 'packages/plugin-template/public/exo-manifest.json'))

  it('declares the two deployed plugins', () => {
    const result = parseExoConfig(readFileSync(join(demo, 'exo.json'), 'utf8'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.plugins.map((plugin) => plugin.manifest)).toEqual([
      'https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json',
      'https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json',
    ])
    expect(result.config.plugins.every((plugin) => plugin.enabled)).toBe(true)
  })

  it.each([
    ['hello.ts', 'TypeScript'],
    ['data.json', 'JSON'],
    ['notes.md', 'Markdown'],
    ['draft.md', 'Markdown'],
  ])('%s selects the code plugin (%s)', (file, label) => {
    expect(matches(code, file).map((editor) => editor.label)).toContain(label)
    expect(matches(template, file)).toEqual([])
    expect(existsSync(join(demo, file))).toBe(true)
  })

  it('greeting.template.txt selects the template plugin', () => {
    expect(matches(template, 'greeting.template.txt').map((editor) => editor.label)).toEqual([
      'Exo Template',
    ])
    expect(matches(code, 'greeting.template.txt')).toEqual([])
    expect(existsSync(join(demo, 'greeting.template.txt'))).toBe(true)
  })

  it('plain.txt is handled by the shell text surface', () => {
    expect(matches(code, 'plain.txt')).toEqual([])
    expect(matches(template, 'plain.txt')).toEqual([])
    expect(existsSync(join(demo, 'plain.txt'))).toBe(true)
  })

  it('has a README with the expected observations', () => {
    const readme = readFileSync(join(demo, 'README.md'), 'utf8')
    expect(readme).toContain('Expected observations')
    expect(readme).toContain('Exo Code')
    expect(readme).toContain('Exo Template')
    expect(readme).toContain('plain.txt')
    expect(readme).toContain('docs/walkthrough.md')
  })
})
