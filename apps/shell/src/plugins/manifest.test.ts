import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MANIFEST_MAX_DESCRIPTION,
  MANIFEST_HTTPS_URL_PATTERN,
  MANIFEST_ID_PATTERN,
  MANIFEST_CONTRIBUTION_ID_PATTERN,
  MANIFEST_MAX_CONTENT_VIEWS,
  MANIFEST_MAX_EDITORS,
  MANIFEST_MAX_PANELS,
  MANIFEST_MAX_VIEW_TITLE,
  MANIFEST_PANEL_LOCATIONS,
  MANIFEST_MAX_ENUM_VALUES,
  MANIFEST_MAX_GLOB_LENGTH,
  MANIFEST_MAX_LABEL,
  MANIFEST_MAX_NAME,
  MANIFEST_MAX_PAGE,
  MANIFEST_MAX_SETTING_DESCRIPTION,
  MANIFEST_MAX_SETTING_KEY,
  MANIFEST_MAX_SETTING_STRING,
  MANIFEST_MAX_SETTINGS,
  MANIFEST_PRIORITY_MAX,
  MANIFEST_PRIORITY_MIN,
  MANIFEST_RELATIVE_ASSET_PATTERN,
  MANIFEST_RELATIVE_PAGE_PATTERN,
  MANIFEST_REQUIRED_FIELDS,
  MANIFEST_RENDERINGS,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SEMVER_PATTERN,
  MANIFEST_SETTING_KEY_PATTERN,
  MANIFEST_SETTING_TYPES,
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

function withConfiguration(properties: Record<string, unknown>) {
  return { contributes: { configuration: { properties } } }
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
      expect(withoutPriority.manifest.fileEditors[0].rendering).toBe('hidden')
    }

    const withoutContributes = manifest()
    delete withoutContributes.contributes
    const withoutContributions = validateManifest(withoutContributes, MANIFEST_URL, SHELL_VERSION)
    expect(withoutContributions.ok).toBe(true)
    if (withoutContributions.ok) {
      expect(withoutContributions.manifest.fileEditors).toEqual([])
    }
  })

  it('accepts frame rendering and rejects unknown values', () => {
    const frame = validate({
      contributes: {
        fileEditors: [{ glob: '**/*.ts', entry: 'editor.html', label: 'Code', rendering: 'frame' }],
      },
    })
    expect(frame.ok).toBe(true)
    if (frame.ok) expect(frame.manifest.fileEditors[0].rendering).toBe('frame')

    expect(
      errorOf(
        validate({
          contributes: {
            fileEditors: [{ glob: '**/*.ts', entry: 'editor.html', label: 'Code', rendering: 'x' }],
          },
        }),
      ).field,
    ).toBe('/contributes/fileEditors/0/rendering')
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

  it('accepts listing with read and rejects listing alone or duplicated', () => {
    const valid = validate({ permissions: ['workspace:read', 'workspace:list'] })
    expect(valid.ok).toBe(true)
    if (valid.ok) {
      expect(valid.manifest.permissions).toEqual(['workspace:read', 'workspace:list'])
    }

    expect(errorOf(validate({ permissions: ['workspace:list'] }))).toMatchObject({
      code: 'invalid-manifest',
      field: '/permissions',
    })
    expect(errorOf(validate({ permissions: ['workspace:write', 'workspace:list'] })).field).toBe(
      '/permissions',
    )
    expect(
      errorOf(validate({ permissions: ['workspace:read', 'workspace:list', 'workspace:list'] }))
        .field,
    ).toBe('/permissions/2')
    expect(
      validate({ permissions: ['workspace:read', 'workspace:list', 'workspace:write'] }).ok,
    ).toBe(true)
  })

  it('accepts a configuration contribution with all supported setting types', () => {
    const result = validate(
      withConfiguration({
        'editor.fontSize': { type: 'number', default: 13, description: 'Font size in pixels.' },
        'editor.theme': {
          type: 'string',
          enum: ['auto', 'dark', 'light'],
          default: 'auto',
          scope: 'workspace',
        },
        'editor.minimap': { type: 'boolean', default: false },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.configuration).toEqual({
      properties: {
        'editor.fontSize': {
          type: 'number',
          default: 13,
          description: 'Font size in pixels.',
          scope: 'workspace',
        },
        'editor.theme': {
          type: 'string',
          enum: ['auto', 'dark', 'light'],
          default: 'auto',
          scope: 'workspace',
        },
        'editor.minimap': { type: 'boolean', default: false, scope: 'workspace' },
      },
    })
  })

  it('accepts an empty property map and an absent configuration', () => {
    expect(validate(withConfiguration({})).ok).toBe(true)
    expect(validate({ contributes: { fileEditors: [] } }).ok).toBe(true)
  })

  it('rejects invalid configuration shapes and setting keys', () => {
    expect(
      errorOf(validate({ contributes: { configuration: { properties: {}, extra: true } } })).field,
    ).toBe('/contributes/configuration/extra')
    expect(errorOf(validate({ contributes: { configuration: {} } })).field).toBe(
      '/contributes/configuration/properties',
    )
    expect(errorOf(validate({ contributes: { configuration: { properties: [] } } })).field).toBe(
      '/contributes/configuration/properties',
    )
    expect(
      errorOf(
        validate(
          withConfiguration({
            'editor.fontSize': { type: 'number', default: 13, extra: true },
          }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/editor.fontSize/extra')
    expect(
      errorOf(validate(withConfiguration({ Bad: { type: 'string', default: 'x' } }))).field,
    ).toBe('/contributes/configuration/properties/Bad')
    expect(
      errorOf(validate(withConfiguration({ 'a..b': { type: 'string', default: 'x' } }))).field,
    ).toBe('/contributes/configuration/properties/a..b')
    expect(
      errorOf(
        validate(
          withConfiguration({
            ['a'.repeat(MANIFEST_MAX_SETTING_KEY + 1)]: { type: 'string', default: 'x' },
          }),
        ),
      ).field,
    ).toBe(`/contributes/configuration/properties/${'a'.repeat(MANIFEST_MAX_SETTING_KEY + 1)}`)
  })

  it('rejects more settings than the limit', () => {
    const properties = Object.fromEntries(
      Array.from({ length: MANIFEST_MAX_SETTINGS + 1 }, (_, index) => [
        `setting${index}`,
        { type: 'string', default: 'x' },
      ]),
    )
    expect(errorOf(validate(withConfiguration(properties))).field).toBe(
      '/contributes/configuration/properties',
    )
  })

  it('rejects missing, mismatched and invalid setting values', () => {
    expect(errorOf(validate(withConfiguration({ setting: { default: 'x' } }))).field).toBe(
      '/contributes/configuration/properties/setting/type',
    )
    expect(
      errorOf(validate(withConfiguration({ setting: { type: 'object', default: {} } }))).field,
    ).toBe('/contributes/configuration/properties/setting/type')
    expect(errorOf(validate(withConfiguration({ setting: { type: 'string' } }))).field).toBe(
      '/contributes/configuration/properties/setting/default',
    )
    expect(
      errorOf(validate(withConfiguration({ setting: { type: 'number', default: '1' } }))).field,
    ).toBe('/contributes/configuration/properties/setting/default')
    expect(
      errorOf(
        validate(
          withConfiguration({ setting: { type: 'number', default: Number.POSITIVE_INFINITY } }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/default')
    expect(
      errorOf(
        validate(
          withConfiguration({
            setting: { type: 'string', default: 'x'.repeat(MANIFEST_MAX_SETTING_STRING + 1) },
          }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/default')
  })

  it('rejects invalid enums, scopes and descriptions', () => {
    expect(
      errorOf(
        validate(
          withConfiguration({ setting: { type: 'boolean', default: true, enum: [true, false] } }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/enum')
    expect(
      errorOf(validate(withConfiguration({ setting: { type: 'string', default: 'a', enum: [] } })))
        .field,
    ).toBe('/contributes/configuration/properties/setting/enum')
    expect(
      errorOf(
        validate(
          withConfiguration({
            setting: { type: 'string', default: 'a', enum: Array(51).fill('a') },
          }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/enum')
    expect(
      errorOf(
        validate(
          withConfiguration({ setting: { type: 'string', default: 'a', enum: ['a', 'a'] } }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/enum')
    expect(
      errorOf(
        validate(withConfiguration({ setting: { type: 'string', default: 'a', enum: ['a', 1] } })),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/enum')
    expect(
      errorOf(
        validate(
          withConfiguration({ setting: { type: 'string', default: 'b', enum: ['a', 'c'] } }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/enum')
    expect(
      errorOf(
        validate(
          withConfiguration({ setting: { type: 'string', default: 'a', scope: 'machine' } }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/scope')
    expect(
      errorOf(
        validate(withConfiguration({ setting: { type: 'string', default: 'a', description: '' } })),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/description')
    expect(
      errorOf(
        validate(
          withConfiguration({
            setting: {
              type: 'string',
              default: 'a',
              description: 'x'.repeat(MANIFEST_MAX_SETTING_DESCRIPTION + 1),
            },
          }),
        ),
      ).field,
    ).toBe('/contributes/configuration/properties/setting/description')
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

  it('accepts panels and content views and resolves their entries', () => {
    const result = validate({
      contributes: {
        panels: [
          {
            id: 'outline',
            title: 'Outline',
            icon: 'list-tree',
            location: 'primary',
            entry: 'views/outline.html',
          },
          { id: 'inspector', title: 'Inspector', location: 'secondary', entry: 'other.html' },
        ],
        contentViews: [{ id: 'tutorial', title: 'Tutorial', entry: 'views/tutorial.html' }],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.panels).toEqual([
      {
        id: 'outline',
        title: 'Outline',
        icon: 'list-tree',
        location: 'primary',
        entry: 'views/outline.html',
        entryUrl: 'https://plugins.example.com/monaco/views/outline.html',
      },
      {
        id: 'inspector',
        title: 'Inspector',
        location: 'secondary',
        entry: 'other.html',
        entryUrl: 'https://plugins.example.com/monaco/other.html',
      },
    ])
    expect(result.manifest.contentViews).toEqual([
      {
        id: 'tutorial',
        title: 'Tutorial',
        entry: 'views/tutorial.html',
        entryUrl: 'https://plugins.example.com/monaco/views/tutorial.html',
      },
    ])
  })

  it('accepts empty panel and content-view arrays', () => {
    const result = validate({ contributes: { panels: [], contentViews: [] } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.panels).toEqual([])
      expect(result.manifest.contentViews).toEqual([])
    }
  })

  it('rejects invalid panel shapes', () => {
    const valid = {
      id: 'outline',
      title: 'Outline',
      location: 'primary',
      entry: 'views/outline.html',
    }
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...valid, id: 'Outline' }, '/contributes/panels/0/id'],
      [{ ...valid, title: '' }, '/contributes/panels/0/title'],
      [{ ...valid, title: 'x'.repeat(MANIFEST_MAX_VIEW_TITLE + 1) }, '/contributes/panels/0/title'],
      [{ ...valid, icon: 'List-Tree' }, '/contributes/panels/0/icon'],
      [{ ...valid, location: 'bottom' }, '/contributes/panels/0/location'],
      [{ ...valid, entry: 'views/outline.txt' }, '/contributes/panels/0/entry'],
      [{ ...valid, location: undefined }, '/contributes/panels/0/location'],
      [{ ...valid, extra: true }, '/contributes/panels/0/extra'],
    ]
    for (const [panel, field] of cases) {
      expect(errorOf(validate({ contributes: { panels: [panel] } })).field).toBe(field)
    }
  })

  it('rejects duplicate panel ids and the panel limit', () => {
    const panel = { id: 'outline', title: 'Outline', location: 'primary', entry: 'outline.html' }
    expect(errorOf(validate({ contributes: { panels: [panel, panel] } })).field).toBe(
      '/contributes/panels/1/id',
    )
    const panels = Array.from({ length: MANIFEST_MAX_PANELS + 1 }, (_, index) => ({
      id: `panel-${index}`,
      title: `Panel ${index}`,
      location: 'primary',
      entry: 'panel.html',
    }))
    expect(errorOf(validate({ contributes: { panels } })).field).toBe('/contributes/panels')
  })

  it('rejects a panel entry outside the plugin root', () => {
    const result = validate({
      contributes: {
        panels: [
          { id: 'outline', title: 'Outline', location: 'primary', entry: '../outline.html' },
        ],
      },
    })
    expect(errorOf(result)).toMatchObject({ code: 'invalid-manifest' })
  })

  it('rejects invalid content-view shapes and limits', () => {
    const valid = { id: 'tutorial', title: 'Tutorial', entry: 'views/tutorial.html' }
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...valid, id: 'Tutorial' }, '/contributes/contentViews/0/id'],
      [{ ...valid, title: '' }, '/contributes/contentViews/0/title'],
      [{ ...valid, entry: 'views/tutorial.txt' }, '/contributes/contentViews/0/entry'],
      [{ ...valid, icon: 'book' }, '/contributes/contentViews/0/icon'],
      [{ ...valid, entry: undefined }, '/contributes/contentViews/0/entry'],
    ]
    for (const [view, field] of cases) {
      expect(errorOf(validate({ contributes: { contentViews: [view] } })).field).toBe(field)
    }
    expect(
      errorOf(validate({ contributes: { contentViews: [valid, { ...valid, title: 'Other' }] } }))
        .field,
    ).toBe('/contributes/contentViews/1/id')
    const views = Array.from({ length: MANIFEST_MAX_CONTENT_VIEWS + 1 }, (_, index) => ({
      id: `view-${index}`,
      title: `View ${index}`,
      entry: 'view.html',
    }))
    expect(errorOf(validate({ contributes: { contentViews: views } })).field).toBe(
      '/contributes/contentViews',
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
      panels: { maxItems: number; items: { $ref: string } }
      contentViews: { maxItems: number; items: { $ref: string } }
      configuration: { $ref: string }
    }
  }
  panel: {
    additionalProperties: boolean
    required: string[]
    properties: {
      id: { $ref: string }
      title: { minLength: number; maxLength: number }
      icon: { minLength: number; maxLength: number; pattern: string }
      location: { enum: string[] }
      entry: { $ref: string }
    }
  }
  contentView: {
    additionalProperties: boolean
    required: string[]
    properties: {
      id: { $ref: string }
      title: { minLength: number; maxLength: number }
      entry: { $ref: string }
    }
  }
  contributionId: { minLength: number; maxLength: number; pattern: string }
  configuration: {
    additionalProperties: boolean
    required: string[]
    properties: {
      properties: {
        maxProperties: number
        propertyNames: { $ref: string }
        additionalProperties: { $ref: string }
      }
    }
  }
  settingKey: { maxLength: number; pattern: string }
  setting: {
    additionalProperties: boolean
    required: string[]
    properties: {
      type: { enum: string[] }
      default: { $ref: string }
      enum: { minItems: number; maxItems: number; uniqueItems: boolean; items: { $ref: string } }
      description: { minLength: number; maxLength: number }
      scope: { const: string }
    }
  }
  settingValue: {
    oneOf: Array<{ type: string; maxLength?: number }>
  }
  fileEditor: {
    required: string[]
    properties: {
      glob: { $ref: string }
      label: { maxLength: number }
      priority: { minimum: number; maximum: number; default: number }
      rendering: { enum: string[]; default: string }
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
    expect(defs.contributes.properties.configuration.$ref).toBe('#/$defs/configuration')
    expect(defs.contributes.properties.fileEditors.maxItems).toBe(MANIFEST_MAX_EDITORS)
    expect(defs.contributes.properties.panels.maxItems).toBe(MANIFEST_MAX_PANELS)
    expect(defs.contributes.properties.contentViews.maxItems).toBe(MANIFEST_MAX_CONTENT_VIEWS)
    expect(defs.panel.required).toEqual(['id', 'title', 'location', 'entry'])
    expect(defs.panel.properties.id.$ref).toBe('#/$defs/contributionId')
    expect(defs.panel.properties.title.maxLength).toBe(MANIFEST_MAX_VIEW_TITLE)
    expect(defs.panel.properties.location.enum).toEqual([...MANIFEST_PANEL_LOCATIONS])
    expect(defs.panel.properties.icon.pattern).toBe('^[a-z0-9-]+$')
    expect(defs.contentView.required).toEqual(['id', 'title', 'entry'])
    expect(defs.contentView.properties.id.$ref).toBe('#/$defs/contributionId')
    expect(defs.contributionId.pattern).toBe(MANIFEST_CONTRIBUTION_ID_PATTERN)
    expect(defs.configuration.additionalProperties).toBe(false)
    expect(defs.configuration.required).toEqual(['properties'])
    expect(defs.configuration.properties.properties.maxProperties).toBe(MANIFEST_MAX_SETTINGS)
    expect(defs.configuration.properties.properties.propertyNames.$ref).toBe('#/$defs/settingKey')
    expect(defs.configuration.properties.properties.additionalProperties.$ref).toBe(
      '#/$defs/setting',
    )
    expect(defs.settingKey.maxLength).toBe(MANIFEST_MAX_SETTING_KEY)
    expect(defs.settingKey.pattern).toBe(MANIFEST_SETTING_KEY_PATTERN)
    expect(defs.setting.additionalProperties).toBe(false)
    expect(defs.setting.required).toEqual(['type', 'default'])
    expect(defs.setting.properties.type.enum).toEqual([...MANIFEST_SETTING_TYPES])
    expect(defs.setting.properties.default.$ref).toBe('#/$defs/settingValue')
    expect(defs.setting.properties.enum.minItems).toBe(1)
    expect(defs.setting.properties.enum.maxItems).toBe(MANIFEST_MAX_ENUM_VALUES)
    expect(defs.setting.properties.enum.uniqueItems).toBe(true)
    expect(defs.setting.properties.enum.items.$ref).toBe('#/$defs/settingValue')
    expect(defs.setting.properties.description.minLength).toBe(1)
    expect(defs.setting.properties.description.maxLength).toBe(MANIFEST_MAX_SETTING_DESCRIPTION)
    expect(defs.setting.properties.scope.const).toBe('workspace')
    expect(defs.settingValue.oneOf.map((entry) => entry.type)).toEqual([
      'boolean',
      'string',
      'number',
    ])
    expect(defs.settingValue.oneOf.find((entry) => entry.type === 'string')?.maxLength).toBe(
      MANIFEST_MAX_SETTING_STRING,
    )
    expect(defs.fileEditor.required).toEqual(['glob', 'entry', 'label'])
    expect(defs.fileEditor.properties.label.maxLength).toBe(MANIFEST_MAX_LABEL)
    expect(defs.fileEditor.properties.glob.$ref).toBe('#/$defs/glob')
    expect(defs.fileEditor.properties.priority.minimum).toBe(MANIFEST_PRIORITY_MIN)
    expect(defs.fileEditor.properties.priority.maximum).toBe(MANIFEST_PRIORITY_MAX)
    expect(defs.fileEditor.properties.priority.default).toBe(0)
    expect(defs.fileEditor.properties.rendering.enum).toEqual([...MANIFEST_RENDERINGS])
    expect(defs.fileEditor.properties.rendering.default).toBe('hidden')
    expect(defs.glob.maxLength).toBe(MANIFEST_MAX_GLOB_LENGTH)
    expect(defs.relativePage.pattern).toBe(MANIFEST_RELATIVE_PAGE_PATTERN)
    expect(defs.relativePage.maxLength).toBe(MANIFEST_MAX_PAGE)
    expect(defs.relativeAsset.pattern).toBe(MANIFEST_RELATIVE_ASSET_PATTERN)
    expect(defs.httpsUrl.pattern).toBe(MANIFEST_HTTPS_URL_PATTERN)
  })

  it('accepts the deployed plugin template manifests', () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), '../../packages/plugin-template/public/exo-manifest.json'),
        'utf8',
      ),
    ) as unknown
    const templateResult = validateManifest(
      template,
      'https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json',
      SHELL_VERSION,
    )
    expect(templateResult.ok).toBe(true)

    const mismatch = JSON.parse(
      readFileSync(
        join(process.cwd(), '../../packages/plugin-template/public/exo-manifest-mismatch.json'),
        'utf8',
      ),
    ) as unknown
    const mismatchResult = validateManifest(
      mismatch,
      'https://mode777.github.io/exo-editor/plugin-template/exo-manifest-mismatch.json',
      SHELL_VERSION,
    )
    expect(mismatchResult.ok).toBe(true)

    const code = JSON.parse(
      readFileSync(join(process.cwd(), '../../apps/code-plugin/public/exo-manifest.json'), 'utf8'),
    ) as unknown
    const codeResult = validateManifest(
      code,
      'https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json',
      SHELL_VERSION,
    )
    expect(codeResult.ok).toBe(true)
    if (codeResult.ok) {
      expect(codeResult.manifest.fileEditors).toHaveLength(4)
      expect(codeResult.manifest.fileEditors.every((editor) => editor.rendering === 'frame')).toBe(
        true,
      )
    }
  })
})
