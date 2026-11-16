#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// The deployed site is static and secret-free by design. This scans the built
// artifact, including the template and code-plugin child paths, for credential
// shapes and for values of secret-like environment variables. It never prints a
// matched value, only the file and pattern name.

const TEXT_EXTENSIONS = [
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.md',
  '.map',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
]

const CREDENTIAL_PATTERNS = [
  { name: 'private-key', expression: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'github-token', expression: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-fine-grained-token', expression: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: 'aws-access-key', expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'openai-key', expression: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'slack-token', expression: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'google-api-key', expression: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'jwt', expression: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'stripe-live-key', expression: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
]

/** Values of environment variables whose names look secret; never printed. */
export function secretEnvironmentValues(environment = process.env) {
  return Object.entries(environment)
    .filter(([name]) => /(TOKEN|SECRET|PASSWORD|API_KEY)$/.test(name))
    .filter(([, value]) => typeof value === 'string' && value.length >= 8)
    .map(([name, value]) => ({ name: `env:${name}`, value }))
}

/**
 * @param {string} distDir
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {Array<{ path: string, pattern: string }>}
 */
export function scanDistForSecrets(distDir, environment = process.env) {
  let stat
  try {
    stat = statSync(distDir)
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`)
  }
  if (!stat.isDirectory()) throw new Error(`Build output at ${distDir} is not a directory.`)

  const envValues = secretEnvironmentValues(environment)
  const violations = []

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        violations.push({ path, pattern: 'symlink' })
        continue
      }
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!TEXT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue
      const source = readFileSync(path, 'utf8')
      for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.expression.test(source)) violations.push({ path, pattern: pattern.name })
      }
      for (const secret of envValues) {
        if (source.includes(secret.value)) violations.push({ path, pattern: secret.name })
      }
    }
  }

  walk(distDir)
  return violations
}

function main() {
  const distDir = resolve(process.argv[2] ?? 'dist')
  const violations = scanDistForSecrets(distDir)
  if (violations.length === 0) {
    console.log('No credential patterns or secret environment values found in the build.')
    return
  }
  for (const violation of violations) {
    console.error(`Credential pattern "${violation.pattern}" found in ${violation.path}`)
  }
  process.exitCode = 1
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
