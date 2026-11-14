import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MANIFEST_MAX_DESCRIPTION,
  MANIFEST_HTTPS_URL_PATTERN,
  MANIFEST_ID_PATTERN,
  MANIFEST_MAX_EDITORS,
  MANIFEST_MAX_GLOB_LENGTH,
  MANIFEST_MAX_LABEL,
  MANIFEST_MAX_NAME,
  MANIFEST_MAX_PAGE,
  MANIFEST_PRIORITY_MAX,
  MANIFEST_PRIORITY_MIN,
  MANIFEST_RELATIVE_ASSET_PATTERN,
  MANIFEST_RELATIVE_PAGE_PATTERN,
  MANIFEST_REQUIRED_FIELDS,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SEMVER_PATTERN,
  PLUGIN_PERMISSIONS,
  loadManifest,
  resolvePluginEntry,
  validateManifest,
  type ManifestIssue,
  type ManifestLoadResult,
} from './manifest'

const SHELL_ORIGIN = 'https://editor.example.com'
const SHELL_VERSION = '0.1.0'
const MANIFEST_URL = 'https://plugins.example.com/monaco/exo-manifest.json'

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'com.example.monaco',
    name: 'Monaco Code Editor',
    version: '1.2.0',
    description: 'Source code editing for the Exo shell.',
    publisher: { name: 'Example Corp', url: 'https://example.com' },
    homepage: 'https://example.com/monaco',
    license: 'MIT',
    icon: 'icon.png',
    engines: { exo: '^0.1.0' },
    runtime: { entry: 'plugin.html' },
    permissions: ['workspace:read', 'workspace:write'],
    contributes: {
      fileEditors: [
        {
          glob: '**/*.{ts,tsx}',
          entry: 'editors/code.html',
          label: 'Code',
          priority: 10,
        },
      ],
    },
    ...overrides,
  }
}

function validate(overrides: Record<string, unknown> = {}, url = MANIFEST_URL) {
  return validateManifest(manifest(overrides), url, SHELL_VERSION)
}

function errorOf(result: ManifestLoadResult): ManifestIssue {
  expect(result.ok).toBe(false)
  return result.ok ? { code: 'invalid-manifest' } : result.error
}

function jsonResponse(
  body: unknown,
  options: {
    status?: number
    contentType?: string
    url?: string
    headers?: Record<string, string>
  } = {},
): Response {
  const response = new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: {
      'content-type': options.contentType ?? 'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (options.url) {
    Object.defineProperty(response, 'url', { value: options.url })
  }
  return response
}

function textResponse(
  body: string,
  options: { status?: number; contentType?: string; url?: string } = {},
): Response {
  const response = new Response(body, {
    status: options.status ?? 200,
    headers: { 'content-type': options.contentType ?? 'application/json' },
  })
  if (options.url) {
    Object.defineProperty(response, 'url', { value: options.url })
  }
  return response
}

afterEach(() => {
  vi.useRealTimers()
})

describe('manifest validation', () => {
  it('accepts a complete manifest and resolves its pages', () => {
    const result = validate()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest).toMatchObject({
      manifestOrigin: 'https://plugins.example.com',
      controllerUrl: 'https://plugins.example.com/monaco/plugin.html',
      pluginRoot: '/monaco/',
      id: 'com.example.monaco',
      name: 'Monaco Code Editor',
      version: '1.2.0',
      permissions: ['workspace:read', 'workspace:write'],
    })
    expect(result.manifest.fileEditors[0]).toMatchObject({
      glob: '**/*.{ts,tsx}',
      entry: 'editors/code.html',
      entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
      label: 'Code',
      priority: 10,
    })
  })

  it('defaults a missing priority to zero and allows no contributions', () => {
    const withoutPriority = validate({
      contributes: {
        fileEditors: [{ glob: '**/*.txt', entry: 'editor.html', label: 'Text' }],
      },
    })
    expect(withoutPriority.ok).toBe(true)
    if (withoutPriority.ok) {
      expect(withoutPriority.manifest.fileEditors[0].priority).toBe(0)
    }

    const withoutContributes = manifest()
    delete withoutContributes.contributes
    const withoutContributions = validateManifest(withoutContributes, MANIFEST_URL, SHELL_VERSION)
    expect(withoutContributions.ok).toBe(true)
    if (withoutContributions.ok) {
      expect(withoutContributions.manifest.fileEditors).toEqual([])
    }
  })

  it('rejects unknown fields at every level', () => {
    expect(errorOf(validate({ extra: true })).field).toBe('/extra')
    expect(errorOf(validate({ publisher: { name: 'Acme', extra: true } })).field).toBe(
      '/publisher/extra',
    )
    expect(errorOf(validate({ engines: { exo: '^0.1.0', extra: true } })).field).toBe(
      '/engines/extra',
    )
    expect(errorOf(validate({ runtime: { entry: 'plugin.html', extra: true } })).field).toBe(
      '/runtime/extra',
    )
    expect(
      errorOf(
        validate({
          contributes: {
            fileEditors: [{ glob: '**/*.ts', entry: 'editor.html', label: 'Code', extra: true }],
          },
        }),
      ).field,
    ).toBe('/contributes/fileEditors/0/extra')
  })

  it('checks the required identity fields', () => {
    for (const field of MANIFEST_REQUIRED_FIELDS) {
      const next = manifest()
      delete next[field]
      const result = validateManifest(next, MANIFEST_URL, SHELL_VERSION)
      expect(errorOf(result).field).toBe(`/${field}`)
    }
  })

  it('rejects an unsupported schema version', () => {
    expect(errorOf(validate({ schemaVersion: 2 }))).toMatchObject({
      code: 'unsupported-version',
      field: '/schemaVersion',
    })
  })

  it('validates identity, display fields and URLs', () => {
    expect(errorOf(validate({ id: 'Bad Id' })).field).toBe('/id')
    expect(errorOf(validate({ name: '' })).field).toBe('/name')
    expect(errorOf(validate({ name: 'x'.repeat(MANIFEST_MAX_NAME + 1) })).field).toBe('/name')
    expect(errorOf(validate({ version: '1.2' })).field).toBe('/version')
    expect(errorOf(validate({ description: 'x'.repeat(MANIFEST_MAX_DESCRIPTION + 1) })).field).toBe(
      '/description',
    )
    expect(errorOf(validate({ publisher: { name: '' } })).field).toBe('/publisher/name')
    expect(errorOf(validate({ publisher: { name: 'Acme', url: 'http://acme.test' } })).field).toBe(
      '/publisher/url',
    )
    expect(errorOf(validate({ homepage: 'http://acme.test' })).field).toBe('/homepage')
    expect(errorOf(validate({ license: '' })).field).toBe('/license')
    expect(errorOf(validate({ icon: 'icon.png?x=1' })).field).toBe('/icon')
  })

  it('checks the engine range and compatibility', () => {
    expect(errorOf(validate({ engines: {} })).field).toBe('/engines/exo')
    expect(errorOf(validate({ engines: { exo: 'not a range' } }))).toMatchObject({
      code: 'invalid-manifest',
      field: '/engines/exo',
    })
    expect(errorOf(validate({ engines: { exo: '^2.0.0' } }))).toMatchObject({
      code: 'incompatible-engine',
      field: '/engines/exo',
    })
    expect(validate({ engines: { exo: '>=0.1.0' } }).ok).toBe(true)
  })

  it('rejects an out-of-root or cross-origin controller entry', () => {
    expect(errorOf(validate({ runtime: { entry: '../shared/plugin.html' } })).field).toBe(
      '/runtime/entry',
    )
    expect(
      errorOf(validate({ runtime: { entry: 'https://cdn.example.net/plugin.html' } })),
    ).toMatchObject({ code: 'unsupported-origin', field: '/runtime/entry' })
    expect(
      errorOf(validate({ runtime: { entry: 'https://plugins.example.com/monaco/plugin.html' } })),
    ).toMatchObject({ code: 'invalid-manifest', field: '/runtime/entry' })
    expect(errorOf(validate({ runtime: { entry: 'plugin.html?x=1' } })).field).toBe(
      '/runtime/entry',
    )
    expect(errorOf(validate({ runtime: { entry: 'plugin.txt' } })).field).toBe('/runtime/entry')
  })

  it('rejects percent-encoded dot segments in the controller entry', () => {
    const result = validate({ runtime: { entry: '%2e%2e/plugin.html' } })
    expect(result.ok).toBe(false)
  })

  it('validates the permission vocabulary and dependency', () => {
    expect(errorOf(validate({ permissions: ['workspace:execute'] })).field).toBe('/permissions/0')
    expect(errorOf(validate({ permissions: ['workspace:read', 'workspace:read'] })).field).toBe(
      '/permissions/1',
    )
    expect(errorOf(validate({ permissions: ['workspace:write'] })).field).toBe('/permissions')
    expect(validate({ permissions: [] }).ok).toBe(true)
  })

  it('rejects the reserved configuration contribution', () => {
    const result = validate({ contributes: { configuration: {} } })
    expect(errorOf(result)).toMatchObject({
      code: 'invalid-manifest',
      field: '/contributes/configuration',
    })
  })

  it('rejects duplicate globs and invalid editor entries', () => {
    const base = { glob: '**/*.ts', entry: 'editor.html', label: 'Code' }
    expect(
      errorOf(
        validate({
          contributes: { fileEditors: [base, { ...base, entry: 'other.html' }] },
        }),
      ).field,
    ).toBe('/contributes/fileEditors/1/glob')

    expect(
      errorOf(
        validate({
          contributes: {
            fileEditors: [{ ...base, glob: '!**/*.ts' }],
          },
        }),
      ).field,
    ).toBe('/contributes/fileEditors/0/glob')

    expect(
      errorOf(
        validate({
          contributes: {
            fileEditors: [{ ...base, entry: 'https://cdn.example.net/editor.html' }],
          },
        }),
      ),
    ).toMatchObject({ code: 'unsupported-origin', field: '/contributes/fileEditors/0/entry' })

    expect(
      errorOf(
        validate({
          contributes: {
            fileEditors: [{ ...base, entry: '../shared/editor.html' }],
          },
        }),
      ).field,
    ).toBe('/contributes/fileEditors/0/entry')

    expect(
      errorOf(
        validate({
          contributes: {
            fileEditors: [{ ...base, entry: '%2e%2e/shared/editor.html' }],
          },
        }),
      ).field,
    ).toBe('/contributes/fileEditors/0/entry')

    expect(
      errorOf(
        validate({
          contributes: {
            fileEditors: [{ ...base, label: 'x'.repeat(MANIFEST_MAX_LABEL + 1) }],
          },
        }),
      ).field,
    ).toBe('/contributes/fileEditors/0/label')

    expect(
      errorOf(
        validate({
          contributes: {
            fileEditors: [{ ...base, priority: MANIFEST_PRIORITY_MAX + 1 }],
          },
        }),
      ).field,
    ).toBe('/contributes/fileEditors/0/priority')
  })

  it('allows sibling and descendant pages and repeated entries with distinct globs', () => {
    const result = validate({
      contributes: {
        fileEditors: [
          { glob: '**/*.ts', entry: 'other.html', label: 'Code' },
          { glob: '**/*.tsx', entry: 'editors/code.html', label: 'TSX' },
          { glob: '**/*.js', entry: 'other.html', label: 'JS' },
        ],
      },
    })
    expect(result.ok).toBe(true)
  })

  it('enforces the editor limit', () => {
    const editors = Array.from({ length: MANIFEST_MAX_EDITORS + 1 }, (_, index) => ({
      glob: `**/*.${index}.ts`,
      entry: 'editor.html',
      label: `Editor ${index}`,
    }))
    expect(errorOf(validate({ contributes: { fileEditors: editors } })).field).toBe(
      '/contributes/fileEditors',
    )
  })

  it('uses a supported final manifest URL', () => {
    expect(validate({}, 'http://localhost:5174/exo-manifest.json').ok).toBe(true)
    expect(errorOf(validate({}, 'http://plugins.example.com/exo-manifest.json'))).toMatchObject({
      code: 'unsupported-origin',
    })
  })
})

describe('entry resolution', () => {
  const origin = 'https://plugins.example.com'
  const root = '/monaco/'

  it('accepts siblings and descendants', () => {
    expect(resolvePluginEntry('other.html', MANIFEST_URL, origin, root)).toMatchObject({
      ok: true,
      url: 'https://plugins.example.com/monaco/other.html',
    })
    expect(resolvePluginEntry('editors/code.html', MANIFEST_URL, origin, root)).toMatchObject({
      ok: true,
      url: 'https://plugins.example.com/monaco/editors/code.html',
    })
  })

  it('rejects escapes and cross-origin pages', () => {
    expect(resolvePluginEntry('../shared/editor.html', MANIFEST_URL, origin, root)).toEqual({
      ok: false,
      reason: 'invalid-contribution',
    })
    expect(
      resolvePluginEntry('https://cdn.example.net/editor.html', MANIFEST_URL, origin, root),
    ).toEqual({ ok: false, reason: 'permission-denied' })
    expect(resolvePluginEntry('other.html', MANIFEST_URL, origin, '/monaco/editors/')).toEqual({
      ok: false,
      reason: 'permission-denied',
    })
  })

  it('rejects encoded dot segments', () => {
    expect(resolvePluginEntry('%2e%2e/shared/editor.html', MANIFEST_URL, origin, root)).toEqual({
      ok: false,
      reason: 'invalid-contribution',
    })
  })
})

describe('manifest fetch', () => {
  it('uses the contract fetch options and returns the final URL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(manifest(), {
        url: 'https://cdn.example.com/monaco/exo-manifest.json',
      }),
    )
    const result = await loadManifest(MANIFEST_URL, {
      shellOrigin: SHELL_ORIGIN,
      shellVersion: SHELL_VERSION,
      fetchImpl,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.manifestOrigin).toBe('https://cdn.example.com')
      expect(result.manifest.controllerUrl).toBe('https://cdn.example.com/monaco/plugin.html')
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      MANIFEST_URL,
      expect.objectContaining({
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('times out after five seconds', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const pending = loadManifest(MANIFEST_URL, {
      shellOrigin: SHELL_ORIGIN,
      shellVersion: SHELL_VERSION,
      fetchImpl,
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(errorOf(await pending).code).toBe('timeout')
  })

  it('reports HTTP status, content type and size failures', async () => {
    const cases: Array<[() => Response, string]> = [
      [() => textResponse('no', { status: 500 }), 'http-status'],
      [() => textResponse('{}', { contentType: 'text/plain' }), 'invalid-manifest'],
      [() => new Response('{}'), 'invalid-manifest'],
      [
        () =>
          new Response('{}', {
            headers: { 'content-type': 'application/json', 'content-length': '300000' },
          }),
        'too-large',
      ],
    ]
    for (const [makeResponse, code] of cases) {
      const result = await loadManifest(MANIFEST_URL, {
        shellOrigin: SHELL_ORIGIN,
        shellVersion: SHELL_VERSION,
        fetchImpl: vi.fn(async () => makeResponse()),
      })
      expect(errorOf(result).code, code).toBe(code)
    }
  })

  it('rejects a body over the cap while streaming', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200 * 1024))
        controller.enqueue(new Uint8Array(100 * 1024))
        controller.close()
      },
    })
    const result = await loadManifest(MANIFEST_URL, {
      shellOrigin: SHELL_ORIGIN,
      shellVersion: SHELL_VERSION,
      fetchImpl: vi.fn(
        async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
      ),
    })
    expect(errorOf(result).code).toBe('too-large')
  })

  it('rejects invalid JSON', async () => {
    const result = await loadManifest(MANIFEST_URL, {
      shellOrigin: SHELL_ORIGIN,
      shellVersion: SHELL_VERSION,
      fetchImpl: vi.fn(async () => textResponse('{')),
    })
    expect(errorOf(result).code).toBe('invalid-json')
  })

  it('classifies cross-origin and same-origin fetch rejections', async () => {
    const cross = await loadManifest(MANIFEST_URL, {
      shellOrigin: SHELL_ORIGIN,
      shellVersion: SHELL_VERSION,
      fetchImpl: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })
    expect(errorOf(cross)).toMatchObject({ code: 'cors' })
    expect(errorOf(cross).message).toContain('https://plugins.example.com')

    const sameOriginUrl = 'https://editor.example.com/monaco/exo-manifest.json'
    const same = await loadManifest(sameOriginUrl, {
      shellOrigin: SHELL_ORIGIN,
      shellVersion: SHELL_VERSION,
      fetchImpl: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })
    expect(errorOf(same).code).toBe('network')
  })

  it('rejects an unsupported request URL before fetching', async () => {
    const fetchImpl = vi.fn()
    const result = await loadManifest('http://plugins.example.com/exo-manifest.json', {
      shellOrigin: SHELL_ORIGIN,
      shellVersion: SHELL_VERSION,
      fetchImpl,
    })
    expect(errorOf(result).code).toBe('unsupported-origin')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a redirect to an unsupported origin', async () => {
    const result = await loadManifest(MANIFEST_URL, {
      shellOrigin: SHELL_ORIGIN,
      shellVersion: SHELL_VERSION,
      fetchImpl: vi.fn(async () =>
        jsonResponse(manifest(), {
          url: 'http://plugins.example.com/monaco/exo-manifest.json',
        }),
      ),
    })
    expect(errorOf(result).code).toBe('unsupported-origin')
  })
})

interface SchemaDefs {
  exoManifest: {
    required: string[]
    additionalProperties: boolean
    properties: {
      schemaVersion: { const: number }
      id: { pattern: string }
      name: { maxLength: number }
      description: { maxLength: number }
      version: { $ref: string }
      publisher: { $ref: string }
      license: { maxLength: number }
      permissions: { maxItems: number; uniqueItems: boolean; items: { enum: string[] } }
      contributes: { $ref: string }
    }
  }
  semver: { pattern: string }
  relativePage: { pattern: string; maxLength: number }
  relativeAsset: { pattern: string }
  httpsUrl: { pattern: string }
  contributes: {
    additionalProperties: boolean
    properties: {
      fileEditors: { maxItems: number; items: { $ref: string } }
      configuration: boolean
    }
  }
  fileEditor: {
    required: string[]
    properties: {
      glob: { $ref: string }
      label: { maxLength: number }
      priority: { minimum: number; maximum: number; default: number }
    }
  }
  glob: { maxLength: number; pattern: string }
}

describe('manifest schema parity', () => {
  it('pins the validator constants to the shared schema', () => {
    let directory = process.cwd()
    let schemaText: string | null = null
    for (let depth = 0; depth < 6 && schemaText === null; depth += 1) {
      const candidate = join(directory, 'schema/exo.schema.json')
      if (existsSync(candidate)) schemaText = readFileSync(candidate, 'utf8')
      directory = dirname(directory)
    }
    if (schemaText === null) throw new Error('schema/exo.schema.json was not found')
    const schema = JSON.parse(schemaText) as { $defs: SchemaDefs }
    const defs = schema.$defs

    expect(defs.exoManifest.required).toEqual([...MANIFEST_REQUIRED_FIELDS])
    expect(defs.exoManifest.additionalProperties).toBe(false)
    expect(defs.exoManifest.properties.schemaVersion.const).toBe(MANIFEST_SCHEMA_VERSION)
    expect(defs.exoManifest.properties.id.pattern).toBe(MANIFEST_ID_PATTERN)
    expect(defs.exoManifest.properties.name.maxLength).toBe(MANIFEST_MAX_NAME)
    expect(defs.exoManifest.properties.description.maxLength).toBe(MANIFEST_MAX_DESCRIPTION)
    expect(defs.exoManifest.properties.version.$ref).toBe('#/$defs/semver')
    expect(defs.exoManifest.properties.publisher.$ref).toBe('#/$defs/publisher')
    expect(defs.semver.pattern).toBe(MANIFEST_SEMVER_PATTERN)
    expect(defs.exoManifest.properties.license.maxLength).toBe(256)
    expect(defs.exoManifest.properties.permissions.maxItems).toBe(PLUGIN_PERMISSIONS.length)
    expect(defs.exoManifest.properties.permissions.uniqueItems).toBe(true)
    expect(defs.exoManifest.properties.permissions.items.enum).toEqual([...PLUGIN_PERMISSIONS])
    expect(defs.contributes.additionalProperties).toBe(false)
    expect(defs.contributes.properties.configuration).toBe(false)
    expect(defs.contributes.properties.fileEditors.maxItems).toBe(MANIFEST_MAX_EDITORS)
    expect(defs.fileEditor.required).toEqual(['glob', 'entry', 'label'])
    expect(defs.fileEditor.properties.label.maxLength).toBe(MANIFEST_MAX_LABEL)
    expect(defs.fileEditor.properties.glob.$ref).toBe('#/$defs/glob')
    expect(defs.fileEditor.properties.priority.minimum).toBe(MANIFEST_PRIORITY_MIN)
    expect(defs.fileEditor.properties.priority.maximum).toBe(MANIFEST_PRIORITY_MAX)
    expect(defs.fileEditor.properties.priority.default).toBe(0)
    expect(defs.glob.maxLength).toBe(MANIFEST_MAX_GLOB_LENGTH)
    expect(defs.relativePage.pattern).toBe(MANIFEST_RELATIVE_PAGE_PATTERN)
    expect(defs.relativePage.maxLength).toBe(MANIFEST_MAX_PAGE)
    expect(defs.relativeAsset.pattern).toBe(MANIFEST_RELATIVE_ASSET_PATTERN)
    expect(defs.httpsUrl.pattern).toBe(MANIFEST_HTTPS_URL_PATTERN)
  })
})
