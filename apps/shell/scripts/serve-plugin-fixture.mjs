#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Serves the stub plugin on a second origin for the plugin-host verification.
// It deliberately has no build step and no dependencies: CORS and JSON content
// types are the two things the host checks. Use "/no-cors/..." to serve the same
// files without Access-Control-Allow-Origin for the negative manifest test.

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(scriptDir, '../public/plugin-host-fixture')
const port = Number(process.env.PORT ?? 5174)
const host = process.env.HOST ?? '127.0.0.1'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function corsHeaders(noCors) {
  return noCors ? {} : { 'access-control-allow-origin': '*' }
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...corsHeaders(false),
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': '*',
    })
    response.end()
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Method not allowed')
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad request')
    return
  }

  const noCors = pathname.startsWith('/no-cors/')
  const relative = noCors ? pathname.slice('/no-cors'.length) : pathname
  if (relative.includes('\u0000')) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad request')
    return
  }

  const file = resolve(root, `.${relative === '/' ? '/index.html' : relative}`)
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Forbidden')
    return
  }

  let body
  try {
    if (!statSync(file).isFile()) throw new Error('not a file')
    body = readFileSync(file)
  } catch {
    response.writeHead(404, {
      ...corsHeaders(noCors),
      'content-type': 'text/plain; charset=utf-8',
    })
    response.end('Not found')
    return
  }

  response.writeHead(200, {
    ...corsHeaders(noCors),
    'cache-control': 'no-store',
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
  })
  if (request.method === 'HEAD') {
    response.end()
  } else {
    response.end(body)
  }
})

server.listen(port, host, () => {
  console.log(`Plugin fixture: http://${host}:${port}/exo-manifest.json`)
  console.log(`No-CORS fixture: http://${host}:${port}/no-cors/exo-manifest.json`)
  console.log('Press Ctrl+C to stop.')
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
