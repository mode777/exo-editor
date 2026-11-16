import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateManifest } from '../plugins/manifest'

function repoRoot(): string {
  let directory = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'docs'))) {
      return directory
    }
    directory = dirname(directory)
  }
  throw new Error('Could not find the repository root.')
}

const root = repoRoot()
const guideDir = join(root, 'docs/guide')
const guideFiles = readdirSync(guideDir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => join(guideDir, name))
const walkthrough = join(root, 'docs/walkthrough.md')
const documents = existsSync(walkthrough) ? [...guideFiles, walkthrough] : guideFiles

function headings(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) =>
    match[1]
      .trim()
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^a-z0-9 -]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-'),
  )
}

function anchors(file: string, anchor: string): boolean {
  return headings(file).includes(anchor.replace(/%20/g, ' '))
}

function relativeLinks(source: string): Array<{ target: string; anchor: string | null }> {
  return [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter(
      (target) =>
        !target.startsWith('http://') &&
        !target.startsWith('https://') &&
        !target.startsWith('mailto:') &&
        !target.startsWith('#'),
    )
    .map((target) => {
      const [path, anchor = null] = target.split('#')
      return { target: decodeURI(path), anchor }
    })
}

describe('plugin author guide', () => {
  it('has resolvable relative links and headings', () => {
    const broken: string[] = []
    for (const file of documents) {
      const source = readFileSync(file, 'utf8')
      for (const link of relativeLinks(source)) {
        const target = resolve(dirname(file), link.target)
        if (!existsSync(target)) {
          broken.push(`${file}: missing ${link.target}`)
          continue
        }
        if (link.anchor && target.endsWith('.md') && !anchors(target, link.anchor)) {
          broken.push(`${file}: missing heading #${link.anchor} in ${link.target}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('names only repository paths that exist', () => {
    const prefixes = ['apps/', 'packages/', 'examples/', 'docs/', 'schema/']
    const broken: string[] = []
    for (const file of documents) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/`([^`\n]+)`/g)) {
        const value = match[1].trim()
        if (!prefixes.some((prefix) => value.startsWith(prefix))) continue
        if (/[\s*{}<>]/.test(value) || value.includes('…')) continue
        const candidate = resolve(root, value.replace(/\/$/, ''))
        if (!existsSync(candidate)) broken.push(`${file}: missing ${value}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('names only runnable npm scripts', () => {
    const scripts = new Set<string>()
    const packages = [join(root, 'package.json')]
    for (const group of ['apps', 'packages']) {
      const directory = join(root, group)
      if (!existsSync(directory)) continue
      for (const name of readdirSync(directory)) {
        const manifest = join(directory, name, 'package.json')
        if (existsSync(manifest)) packages.push(manifest)
      }
    }
    for (const file of packages) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        scripts?: Record<string, string>
      }
      for (const name of Object.keys(parsed.scripts ?? {})) scripts.add(name)
    }

    const broken: string[] = []
    for (const file of documents) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
        if (!scripts.has(match[1])) broken.push(`${file}: missing script ${match[1]}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('validates every marked manifest example with the real validator', () => {
    const examples: Array<{ file: string; json: string }> = []
    for (const file of documents) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<!-- exo:manifest -->\s*```json\n([\s\S]*?)```/g)) {
        examples.push({ file, json: match[1] })
      }
    }
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      const parsed = JSON.parse(example.json) as unknown
      const result = validateManifest(
        parsed,
        'https://plugins.example.com/guide/exo-manifest.json',
        '0.1.0',
      )
      expect(result.ok, `${example.file}: ${JSON.stringify(result)}`).toBe(true)
    }
  })
})
