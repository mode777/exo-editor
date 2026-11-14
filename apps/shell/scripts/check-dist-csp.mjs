#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Asserts the deployed document carries the ratified CSP. This runs against the
// build output, not the source constant, so a transform or template regression
// fails the pipeline instead of slipping into the deploy.
const EXPECTED_DIRECTIVES = ['frame-src https:', "connect-src 'self' https:", "script-src 'self'"]

const indexFile = resolve(process.argv[2] ?? 'dist/index.html')
const html = readFileSync(indexFile, 'utf8')

const metas = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/g)]
if (metas.length !== 1) {
  console.error(`Expected exactly one CSP meta tag in ${indexFile}, found ${metas.length}.`)
  process.exitCode = 1
} else {
  const contentMatch = metas[0][0].match(/content="([^"]*)"/)
  if (!contentMatch) {
    console.error('CSP meta tag has no content attribute.')
    process.exitCode = 1
  } else {
    const content = contentMatch[1].replaceAll('&#39;', "'").replaceAll('&quot;', '"')

    const missing = EXPECTED_DIRECTIVES.filter((directive) => !content.includes(directive))
    const forbidden = ['unsafe-eval', 'unsafe-inline', 'default-src', 'style-src'].filter((token) =>
      content.includes(token),
    )

    if (missing.length > 0) {
      console.error(`CSP is missing directive(s): ${missing.join(', ')}`)
      process.exitCode = 1
    }
    if (forbidden.length > 0) {
      console.error(`CSP contains forbidden token(s): ${forbidden.join(', ')}`)
      process.exitCode = 1
    }
    if (missing.length === 0 && forbidden.length === 0) {
      console.log(`CSP verified in ${indexFile}: ${content}`)
    }
  }
}
