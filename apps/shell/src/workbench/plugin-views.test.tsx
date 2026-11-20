import { describe, expect, it } from 'vitest'
import { validateManifest, type PluginManifest } from '../plugins/manifest'
import type { PluginHostRecord, PluginHostSnapshot } from '../plugins/host'
import type { RegisteredContentView, RegisteredPanel } from '../plugins/registration'
import { derivePluginWorkbench, pluginViewId } from './plugin-views'

const IDENTITY = 'https://plugins.example.com::com.example.viewer'

function manifest(): PluginManifest {
  const result = validateManifest(
    {
      schemaVersion: 1,
      id: 'com.example.viewer',
      name: 'Viewer',
      version: '1.0.0',
      publisher: { name: 'Example' },
      engines: { exo: '*' },
      runtime: { entry: 'plugin.html' },
      permissions: ['workspace:read'],
      contributes: {
        fileEditors: [],
        panels: [
          {
            id: 'outline',
            title: 'Outline',
            icon: 'list-tree',
            location: 'primary',
            entry: 'views/outline.html',
          },
          {
            id: 'inspector',
            title: 'Inspector',
            location: 'secondary',
            entry: 'views/inspector.html',
          },
        ],
        contentViews: [{ id: 'tutorial', title: 'Tutorial', entry: 'views/tutorial.html' }],
      },
    },
    'https://plugins.example.com/viewer/exo-manifest.json',
    '0.3.0',
  )
  if (!result.ok) throw new Error(`Invalid fixture: ${result.error.code}`)
  return result.manifest
}

function record(active = true): PluginHostRecord {
  const value = manifest()
  return {
    manifestUrl: value.manifestUrl,
    entryIndex: 0,
    enabled: true,
    phase: active ? 'active' : 'disabled',
    ...(active ? { identity: IDENTITY } : {}),
    manifest: value,
    fingerprint: 'v1:test',
    consent: 'granted',
    registrations: [],
    panels: value.panels.map<RegisteredPanel>((panel, order) => ({
      ...panel,
      registrationOrder: order,
    })),
    contentViews: value.contentViews.map<RegisteredContentView>((view, order) => ({
      ...view,
      registrationOrder: order,
    })),
    commands: [],
    newFiles: [],
  }
}

function snapshot(records: PluginHostRecord[]): PluginHostSnapshot {
  return { phase: 'ready', records, consentRequest: null, log: [], revision: 1 }
}

describe('derived plugin workbench', () => {
  it('adds primary panels after the explorer and enables the secondary region', () => {
    const derived = derivePluginWorkbench(snapshot([record()]))
    const primaryId = pluginViewId(IDENTITY, 'outline')
    const secondaryId = pluginViewId(IDENTITY, 'inspector')

    expect(derived.config.activityBar.items.map((item) => item.id)).toEqual(['explorer', primaryId])
    expect(derived.config.activityBar.items[1]).toMatchObject({
      title: 'Outline — Viewer',
      icon: 'list-tree',
    })
    expect(derived.config.primarySideBar.views).toEqual(['explorer', primaryId])
    expect(derived.config.secondarySideBar).toMatchObject({
      enabled: true,
      views: [secondaryId],
    })
    expect(derived.views.primary[primaryId]).toMatchObject({
      title: 'Outline — Viewer',
      icon: 'list-tree',
    })
    expect(derived.views.secondary[secondaryId]?.actions).toEqual([
      { icon: 'list-selection', label: 'Select View', commandId: 'exo.views.selectSecondary' },
    ])
  })

  it('keeps the shell composition when no panel is active', () => {
    const derived = derivePluginWorkbench(snapshot([record(false)]))
    expect(derived.config.activityBar.items.map((item) => item.id)).toEqual(['explorer'])
    expect(derived.config.primarySideBar.views).toEqual(['explorer'])
    expect(derived.config.secondarySideBar.enabled).toBe(false)
    expect(derived.views.secondary).toEqual({})
  })

  it('uses the default icon for a panel without one', () => {
    const derived = derivePluginWorkbench(snapshot([record()]))
    const secondaryId = pluginViewId(IDENTITY, 'inspector')
    expect(derived.views.secondary[secondaryId]?.icon).toBe('window')
  })
})
