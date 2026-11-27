#!/usr/bin/env node
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FEED_MAX_BYTES,
  SOURCES_MAX_BYTES,
  parseJson,
  validateFeed,
  validateSources,
} from './marketplace-validation.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const distDir = resolve(repoRoot, process.argv[2] ?? 'apps/shell/dist')

function resolveInput(environmentValue, fallback) {
  if (!environmentValue) return resolve(repoRoot, fallback)
  return isAbsolute(environmentValue) ? environmentValue : resolve(process.cwd(), environmentValue)
}

function printIssues(label, issues) {
  for (const issue of issues) {
    const where = issue.field ? ` at ${issue.field}` : ''
    console.error(`${label}: ${issue.code}${where}${issue.message ? ` - ${issue.message}` : ''}`)
  }
}

async function readDocument(path, label, maxBytes, code) {
  let bytes
  try {
    bytes = await readFile(path)
  } catch (error) {
    throw new Error(
      `${label} could not be read at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(`${label} at ${path} exceeds ${maxBytes} bytes.`)
  }
  const parsed = parseJson(new TextDecoder().decode(bytes), code)
  if (!parsed.ok) {
    printIssues(label, parsed.issues)
    throw new Error(`${label} is not valid JSON.`)
  }
  return parsed.value
}

async function writeAtomically(target, contents) {
  const temporary = `${target}.tmp`
  await writeFile(temporary, contents)
  await rename(temporary, target)
}

async function main() {
  const sourcesPath = resolveInput(process.env.EXO_MARKETPLACE_SOURCES, 'marketplace/sources.json')
  const feedPath = resolveInput(process.env.EXO_MARKETPLACE_FEED, 'marketplace/marketplace.json')

  const sources = await readDocument(
    sourcesPath,
    'Marketplace sources',
    SOURCES_MAX_BYTES,
    'invalid-sources',
  )
  const sourceValidation = validateSources(sources)
  if (!sourceValidation.ok) {
    printIssues('Marketplace sources', sourceValidation.issues)
    throw new Error('Marketplace sources failed validation.')
  }

  const feed = await readDocument(feedPath, 'Marketplace feed', FEED_MAX_BYTES, 'invalid-feed')
  const feedValidation = validateFeed(feed)
  if (!feedValidation.ok) {
    printIssues('Marketplace feed', feedValidation.issues)
    throw new Error('Marketplace feed failed validation.')
  }

  await mkdir(distDir, { recursive: true })
  const targets = [
    {
      path: resolve(distDir, 'marketplace-sources.json'),
      contents: `${JSON.stringify(sources, null, 2)}\n`,
    },
    { path: resolve(distDir, 'marketplace.json'), contents: `${JSON.stringify(feed, null, 2)}\n` },
  ]
  try {
    for (const target of targets) await writeAtomically(target.path, target.contents)
  } catch (error) {
    for (const target of targets) await rm(target.path, { force: true })
    throw error
  }

  console.log(`Copied marketplace sources to ${targets[0].path}`)
  console.log(`Copied marketplace feed to ${targets[1].path}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
