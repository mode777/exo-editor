#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const ASSET_CLASSES = {
  js: ['.js', '.mjs'],
  css: ['.css'],
}

const GZIP_LEVEL = 9
const REPORT_CLASSES = Object.keys(ASSET_CLASSES)

/**
 * @typedef {{ path: string, bytes: number }} AssetFile
 * @typedef {{ bytes: number, files: AssetFile[] }} AssetMeasurement
 * @typedef {Record<string, AssetMeasurement>} BundleMeasurement
 * @typedef {Record<string, number>} BudgetLimits
 */

/**
 * @param {string} distDir
 * @returns {BundleMeasurement}
 */
export function measureBundle(distDir) {
  let entries
  try {
    entries = statSync(distDir)
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`)
  }
  if (!entries.isDirectory()) {
    throw new Error(`Build output at ${distDir} is not a directory.`)
  }

  const measured = {}
  for (const assetClass of REPORT_CLASSES) {
    measured[assetClass] = { bytes: 0, files: [] }
  }

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      const assetClass = REPORT_CLASSES.find((name) =>
        ASSET_CLASSES[name].some((extension) => entry.name.endsWith(extension)),
      )
      if (!assetClass) continue
      const bytes = gzipSync(readFileSync(path), { level: GZIP_LEVEL }).length
      measured[assetClass].bytes += bytes
      measured[assetClass].files.push({ path, bytes })
    }
  }
  walk(distDir)

  return measured
}

/**
 * @param {string} budgetFile
 * @returns {BudgetLimits}
 */
export function readBudget(budgetFile) {
  let raw
  try {
    raw = readFileSync(budgetFile, 'utf8')
  } catch {
    throw new Error(`Budget file not found at ${budgetFile}.`)
  }

  let budget
  try {
    budget = JSON.parse(raw)
  } catch {
    throw new Error(`Budget file at ${budgetFile} is not valid JSON.`)
  }

  const limits = budget?.limits
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new Error(`Budget file at ${budgetFile} must have a "limits" object.`)
  }
  for (const assetClass of REPORT_CLASSES) {
    if (typeof limits[assetClass] !== 'number' || !Number.isFinite(limits[assetClass])) {
      throw new Error(
        `Budget file at ${budgetFile} is missing a numeric limit for "${assetClass}".`,
      )
    }
  }

  return limits
}

/**
 * @param {BundleMeasurement} measured
 * @param {BudgetLimits} limits
 * @returns {{ ok: boolean, overages: Array<{ assetClass: string, actual: number, limit: number }> }}
 */
export function evaluateBudget(measured, limits) {
  const overages = []
  for (const assetClass of REPORT_CLASSES) {
    const actual = measured[assetClass]?.bytes ?? 0
    const limit = limits[assetClass]
    if (actual > limit) overages.push({ assetClass, actual, limit })
  }
  return { ok: overages.length === 0, overages }
}

/**
 * @param {BundleMeasurement} measured
 * @param {BudgetLimits} limits
 * @returns {string}
 */
export function formatReport(measured, limits) {
  const lines = ['Bundle budget (gzip bytes):']
  for (const assetClass of REPORT_CLASSES) {
    const actual = measured[assetClass]?.bytes ?? 0
    const limit = limits[assetClass]
    const status = actual > limit ? 'OVER' : 'OK'
    lines.push(
      `  ${assetClass.padEnd(4)} ${String(actual).padStart(8)}  limit ${String(limit).padStart(8)}  ${status}`,
    )
  }
  return lines.join('\n')
}

async function main() {
  const distDir = resolve(process.argv[2] ?? 'dist')
  const budgetFile = resolve(process.argv[3] ?? 'budget.json')

  const limits = readBudget(budgetFile)
  const measured = measureBundle(distDir)
  const { ok, overages } = evaluateBudget(measured, limits)

  console.log(formatReport(measured, limits))
  if (!ok) {
    for (const { assetClass, actual, limit } of overages) {
      console.error(
        `Budget failure: ${assetClass} is ${actual - limit} bytes over its ${limit}-byte budget.`,
      )
    }
    process.exitCode = 1
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
