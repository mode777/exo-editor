import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXO_CONFIG_MAX_BYTES,
  EXO_CONFIG_MAX_PLUGINS,
  EXO_CONFIG_PATH,
  EXO_CONFIG_SCHEMA_VERSION,
  EXO_MANIFEST_URL_PATTERN,
  addPluginEntry,
  emptyExoConfig,
  normalizeManifestUrl,
  parseExoConfig,
  removePluginEntry,
  serializeExoConfig,
  setPluginEnabled,
  toPluginConfigEntries,
  validateExoConfig,
  type PluginConfigIssue,
} from './config'

function issuesOf(text: string): PluginConfigIssue[] {
  const result = parseExoConfig(text)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.issues
}

function valid(...manifests: string[]) {
  return JSON.stringify({
    schemaVersion: 1,
    plugins: manifests.map((manifest) => ({ manifest })),
  })
}

describe('exo.json validation', () => {
  it('accepts an empty declaration and defaults enabled to true', () => {
    expect(parseExoConfig('{"schemaVersion":1,"plugins":[]}')).toEqual({
      ok: true,
      config: { schemaVersion: 1, plugins: [] },
    })

    const result = parseExoConfig(valid('https://plugins.example.com/monaco/exo-manifest.json'))
    expect(result).toEqual({
      ok: true,
      config: {
        schemaVersion: 1,
        plugins: [
          {
            manifest: 'https://plugins.example.com/monaco/exo-manifest.json',
            enabled: true,
          },
        ],
      },
    })
  })

  it('accepts https URLs with queries and http localhost', () => {
    for (const url of [
      'https://example.com/manifest.json',
      'https://EXAMPLE.com/manifest.json?version=1',
      'http://localhost:5174/exo-manifest.json',
      'http://localhost/exo-manifest.json',
    ]) {
      expect(normalizeManifestUrl(url)).not.toBeNull()
    }
  })

  it('rejects invalid JSON and comments', () => {
    expect(issuesOf('')).toEqual([{ code: 'invalid-json', path: EXO_CONFIG_PATH }])
    expect(issuesOf('{/* comment */ "schemaVersion":1,"plugins":[]}')).toEqual([
      { code: 'invalid-json', path: EXO_CONFIG_PATH },
    ])
    expect(issuesOf('{"schemaVersion":1,"plugins":[],}')).toEqual([
      { code: 'invalid-json', path: EXO_CONFIG_PATH },
    ])
  })

  it('rejects a non-object root', () => {
    for (const text of ['null', '[]', '"text"', '1']) {
      expect(issuesOf(text)).toEqual([{ code: 'invalid-config', path: EXO_CONFIG_PATH }])
    }
  })

  it('rejects unknown top-level and entry fields with pointers', () => {
    expect(issuesOf('{"schemaVersion":1,"plugins":[],"name":"x"}')).toEqual([
      {
        code: 'invalid-config',
        path: EXO_CONFIG_PATH,
        field: '/name',
      },
    ])
    expect(
      issuesOf(
        '{"schemaVersion":1,"plugins":[{"manifest":"https://example.com/m.json","extra":true}]}',
      ),
    ).toEqual([
      {
        code: 'invalid-config',
        path: EXO_CONFIG_PATH,
        field: '/plugins/0/extra',
        entryIndex: 0,
      },
    ])
  })

  it('rejects missing and unsupported schema versions', () => {
    expect(issuesOf('{"plugins":[]}')).toEqual([
      { code: 'invalid-config', path: EXO_CONFIG_PATH, field: '/schemaVersion' },
    ])
    for (const version of [2, 0, '1', null, true]) {
      expect(issuesOf(JSON.stringify({ schemaVersion: version, plugins: [] }))).toEqual([
        { code: 'unsupported-version', path: EXO_CONFIG_PATH, field: '/schemaVersion' },
      ])
    }
  })

  it('rejects a missing or non-array plugins value', () => {
    expect(issuesOf('{"schemaVersion":1}')).toEqual([
      { code: 'invalid-config', path: EXO_CONFIG_PATH, field: '/plugins' },
    ])
    expect(issuesOf('{"schemaVersion":1,"plugins":{}}')).toEqual([
      { code: 'invalid-config', path: EXO_CONFIG_PATH, field: '/plugins' },
    ])
  })

  it('rejects more than the 50-entry limit without usable entries', () => {
    const plugins = Array.from({ length: EXO_CONFIG_MAX_PLUGINS + 1 }, (_, index) => ({
      manifest: `https://example.com/${index}.json`,
    }))
    const result = parseExoConfig(JSON.stringify({ schemaVersion: 1, plugins }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      { code: 'too-many-plugins', path: EXO_CONFIG_PATH, field: '/plugins' },
    ])
  })

  it('rejects invalid entry shapes and types', () => {
    expect(issuesOf('{"schemaVersion":1,"plugins":[1]}')).toEqual([
      { code: 'invalid-config', path: EXO_CONFIG_PATH, field: '/plugins/0', entryIndex: 0 },
    ])
    expect(issuesOf('{"schemaVersion":1,"plugins":[{}]}')).toEqual([
      {
        code: 'invalid-config',
        path: EXO_CONFIG_PATH,
        field: '/plugins/0/manifest',
        entryIndex: 0,
      },
    ])
    expect(issuesOf('{"schemaVersion":1,"plugins":[{"manifest":1}]}')).toEqual([
      {
        code: 'invalid-config',
        path: EXO_CONFIG_PATH,
        field: '/plugins/0/manifest',
        entryIndex: 0,
      },
    ])
    expect(
      issuesOf(
        '{"schemaVersion":1,"plugins":[{"manifest":"https://example.com/m.json","enabled":"yes"}]}',
      ),
    ).toEqual([
      {
        code: 'invalid-config',
        path: EXO_CONFIG_PATH,
        field: '/plugins/0/enabled',
        entryIndex: 0,
      },
    ])
  })

  it('rejects every insecure or malformed manifest URL', () => {
    for (const url of [
      'manifest.json',
      'http://example.com/m.json',
      'https://user:pass@example.com/m.json',
      'https://example.com/m.json#fragment',
      'https://example.com/m.json#',
      'HTTPS://example.com/m.json',
      'https://exa mple.com/m.json',
      'ftp://example.com/m.json',
    ]) {
      const result = validateExoConfig({
        schemaVersion: 1,
        plugins: [{ manifest: url }],
      })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.issues[0]).toMatchObject({
        code: 'invalid-config',
        field: '/plugins/0/manifest',
        entryIndex: 0,
      })
    }
  })

  it('normalizes host casing and default ports for duplicate detection', () => {
    const result = validateExoConfig({
      schemaVersion: 1,
      plugins: [
        { manifest: 'https://EXAMPLE.com:443/plugin.json' },
        { manifest: 'https://example.com/plugin.json' },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      {
        code: 'duplicate-manifest',
        path: EXO_CONFIG_PATH,
        field: '/plugins/0/manifest',
        entryIndex: 0,
      },
      {
        code: 'duplicate-manifest',
        path: EXO_CONFIG_PATH,
        field: '/plugins/1/manifest',
        entryIndex: 1,
      },
    ])
  })

  it('collects a partial failure and rejects every entry', () => {
    const result = parseExoConfig(
      JSON.stringify({
        schemaVersion: 1,
        plugins: [
          { manifest: 'https://example.com/ok.json' },
          { manifest: 'http://example.com/bad.json' },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      {
        code: 'invalid-config',
        path: EXO_CONFIG_PATH,
        field: '/plugins/1/manifest',
        entryIndex: 1,
      },
    ])
  })

  it('does not put raw file content in diagnostics', () => {
    const secret = 'TOP-SECRET-CONTENT'
    const issues = issuesOf(JSON.stringify({ schemaVersion: 1, plugins: [], secret }))
    expect(JSON.stringify(issues)).not.toContain(secret)
    expect(issues[0]).toMatchObject({ code: 'invalid-config', field: '/secret' })
  })

  it('pins the validator constants to the shared schema', () => {
    let directory = process.cwd()
    let schemaText: string | null = null
    for (let depth = 0; depth < 6 && schemaText === null; depth += 1) {
      const candidate = join(directory, 'schema/exo.schema.json')
      if (existsSync(candidate)) schemaText = readFileSync(candidate, 'utf8')
      directory = dirname(directory)
    }
    if (schemaText === null) throw new Error('schema/exo.schema.json was not found')
    const schema = JSON.parse(schemaText) as {
      $defs: {
        exoFile: {
          additionalProperties: boolean
          required: string[]
          properties: {
            schemaVersion: { const: number }
            plugins: { maxItems: number; items: { $ref: string } }
          }
        }
        pluginEntry: {
          additionalProperties: boolean
          required: string[]
          properties: Record<string, { default?: boolean }>
        }
        manifestUrl: { pattern: string }
      }
    }

    expect(schema.$defs.exoFile.additionalProperties).toBe(false)
    expect(schema.$defs.exoFile.required).toEqual(['schemaVersion', 'plugins'])
    expect(schema.$defs.exoFile.properties.schemaVersion.const).toBe(EXO_CONFIG_SCHEMA_VERSION)
    expect(schema.$defs.exoFile.properties.plugins.maxItems).toBe(EXO_CONFIG_MAX_PLUGINS)
    expect(schema.$defs.exoFile.properties.plugins.items.$ref).toBe('#/$defs/pluginEntry')
    expect(schema.$defs.pluginEntry.additionalProperties).toBe(false)
    expect(schema.$defs.pluginEntry.required).toEqual(['manifest'])
    expect(Object.keys(schema.$defs.pluginEntry.properties).sort()).toEqual(['enabled', 'manifest'])
    expect(schema.$defs.pluginEntry.properties.enabled?.default).toBe(true)
    expect(schema.$defs.manifestUrl.pattern).toBe(EXO_MANIFEST_URL_PATTERN)
    expect(EXO_CONFIG_MAX_BYTES).toBe(256 * 1024)
  })
})

describe('canonical exo.json writing', () => {
  const canonical =
    '{\n' +
    '  "schemaVersion": 1,\n' +
    '  "plugins": [\n' +
    '    {\n' +
    '      "manifest": "https://a.example/m.json",\n' +
    '      "enabled": true\n' +
    '    },\n' +
    '    {\n' +
    '      "manifest": "https://b.example/m.json",\n' +
    '      "enabled": false\n' +
    '    }\n' +
    '  ]\n' +
    '}\n'

  function configOf(text = canonical) {
    const result = parseExoConfig(text)
    if (!result.ok) throw new Error('fixture is invalid')
    return result.config
  }

  it('emits the canonical bytes, explicit enabled and a trailing newline', () => {
    expect(serializeExoConfig(configOf(valid('https://example.com/m.json')))).toBe(
      '{\n' +
        '  "schemaVersion": 1,\n' +
        '  "plugins": [\n' +
        '    {\n' +
        '      "manifest": "https://example.com/m.json",\n' +
        '      "enabled": true\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    )
    expect(serializeExoConfig(emptyExoConfig())).toBe(
      '{\n  "schemaVersion": 1,\n  "plugins": []\n}\n',
    )
  })

  it('changes only the intended flag when toggling an entry', () => {
    const next = serializeExoConfig(setPluginEnabled(configOf(), 1, true))
    const before = canonical.split('\n')
    const after = next.split('\n')
    const changed = before.map((line, index) => line !== after[index]).filter(Boolean)
    expect(changed).toHaveLength(1)
    expect(after).toContain('      "enabled": true')
  })

  it('adds and removes one entry without reordering the rest', () => {
    const config = configOf()
    const added = addPluginEntry(config, 'https://c.example/m.json')
    expect(toPluginConfigEntries(added).map((entry) => entry.manifest)).toEqual([
      'https://a.example/m.json',
      'https://b.example/m.json',
      'https://c.example/m.json',
    ])
    expect(added.plugins[2]).toEqual({
      manifest: 'https://c.example/m.json',
      enabled: true,
    })

    const removed = removePluginEntry(config, 0)
    expect(toPluginConfigEntries(removed)).toEqual([
      { index: 0, manifest: 'https://b.example/m.json', enabled: false },
    ])
  })

  it('rejects an out-of-range structured edit', () => {
    expect(() => setPluginEnabled(configOf(), 2, true)).toThrow(RangeError)
    expect(() => removePluginEntry(configOf(), -1)).toThrow(RangeError)
  })
})
