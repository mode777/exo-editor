import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateBudget, measureBundle, readBudget } from '../../scripts/check-bundle-budget.mjs'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'exo-budget-'))
}

let created: string[] = []

afterEach(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
  created = []
})

function makeDir() {
  const dir = tempDir()
  created.push(dir)
  return dir
}

describe('bundle budget', () => {
  it('measures gzipped js and css assets recursively', () => {
    const dist = makeDir()
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'assets', 'index.js'), 'console.log("budget")'.repeat(200))
    writeFileSync(join(dist, 'assets', 'index.css'), '.a{color:red}'.repeat(200))
    writeFileSync(join(dist, 'index.html'), '<html></html>')

    const measured = measureBundle(dist)

    expect(measured.js.bytes).toBeGreaterThan(0)
    expect(measured.css.bytes).toBeGreaterThan(0)
    expect(measured.js.files).toHaveLength(1)
    expect(measured.css.files).toHaveLength(1)
    expect(measured.js.files[0].path.endsWith('index.js')).toBe(true)
  })

  it('passes when every class is within its limit', () => {
    const result = evaluateBudget(
      { js: { bytes: 100, files: [] }, css: { bytes: 10, files: [] } },
      { js: 100, css: 10 },
    )

    expect(result.ok).toBe(true)
    expect(result.overages).toEqual([])
  })

  it('reports each class that exceeds its limit', () => {
    const result = evaluateBudget(
      { js: { bytes: 100, files: [] }, css: { bytes: 10, files: [] } },
      { js: 99, css: 5 },
    )

    expect(result.ok).toBe(false)
    expect(result.overages).toEqual([
      { assetClass: 'js', actual: 100, limit: 99 },
      { assetClass: 'css', actual: 10, limit: 5 },
    ])
  })

  it('fails clearly when the build output is missing', () => {
    expect(() => measureBundle(join(makeDir(), 'dist'))).toThrow(/not found/)
  })

  it('rejects a budget without every asset class', () => {
    const dir = makeDir()
    const budgetFile = join(dir, 'budget.json')
    writeFileSync(budgetFile, JSON.stringify({ limits: { js: 1 } }))

    expect(() => readBudget(budgetFile)).toThrow(/css/)
  })

  it('rejects malformed budget JSON', () => {
    const dir = makeDir()
    const budgetFile = join(dir, 'budget.json')
    writeFileSync(budgetFile, '{not json')

    expect(() => readBudget(budgetFile)).toThrow(/not valid JSON/)
  })

  it('ships a valid committed budget', () => {
    const limits = readBudget(join(process.cwd(), 'budget.json'))

    expect(limits.js).toBeGreaterThan(0)
    expect(limits.css).toBeGreaterThan(0)
  })
})
