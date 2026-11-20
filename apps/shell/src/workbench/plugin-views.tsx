import { useCallback, useRef } from 'react'
import type { ViewDefinition, WorkbenchConfig, WorkbenchViewRegistry } from 'vscode-workbench'
import { usePluginHost, useViewPoolSnapshot, useWorkspaceRuntime } from '../workspace/context'
import type { PluginHostRecord, PluginHostSnapshot } from '../plugins/host'
import type { RegisteredPanel } from '../plugins/registration'
import type { ViewPluginInfo } from '../plugins/view-pool'
import { workbenchConfig } from './config'
import { workbenchViews } from './views'

export function pluginViewId(identity: string, panelId: string): string {
  return `plugin:${encodeURIComponent(identity)}:${panelId}`
}

function pluginInfo(record: PluginHostRecord): ViewPluginInfo {
  if (!record.manifest || !record.identity) {
    throw new Error('An active plugin panel needs an identity and manifest.')
  }
  return {
    identity: record.identity,
    pluginId: record.manifest.id,
    pluginName: record.manifest.name,
    pluginVersion: record.manifest.version,
    origin: record.manifest.manifestOrigin,
    permissions: record.manifest.permissions,
  }
}

function panelDefinition(record: PluginHostRecord, panel: RegisteredPanel): ViewDefinition {
  if (!record.identity) throw new Error('A panel needs an active plugin identity.')
  const id = pluginViewId(record.identity, panel.id)
  const definition: ViewDefinition = {
    id,
    title: `${panel.title} — ${record.manifest?.name ?? 'Plugin'}`,
    icon: panel.icon ?? 'window',
    component: () => <PanelSurface identity={record.identity as string} panelId={panel.id} />,
  }
  if (panel.location === 'secondary') {
    definition.actions = [
      {
        icon: 'list-selection',
        label: 'Select View',
        commandId: 'exo.views.selectSecondary',
      },
    ]
  }
  return definition
}

/** Derive the activity bar, both side-bar registries and the views from the host. */
export function derivePluginWorkbench(host: PluginHostSnapshot): {
  config: WorkbenchConfig
  views: WorkbenchViewRegistry
} {
  const primary: ViewDefinition[] = []
  const secondary: ViewDefinition[] = []
  for (const record of host.records) {
    if (record.phase !== 'active' || !record.manifest || !record.identity) continue
    for (const panel of record.panels) {
      const definition = panelDefinition(record, panel)
      if (panel.location === 'primary') primary.push(definition)
      else secondary.push(definition)
    }
  }

  const primaryViews: Record<string, ViewDefinition> = { ...workbenchViews.primary }
  for (const definition of primary) primaryViews[definition.id] = definition
  const secondaryViews: Record<string, ViewDefinition> = {}
  for (const definition of secondary) secondaryViews[definition.id] = definition

  return {
    config: {
      ...workbenchConfig,
      activityBar: {
        ...workbenchConfig.activityBar,
        items: [
          ...workbenchConfig.activityBar.items,
          ...primary.map((definition) => ({
            id: definition.id,
            title: definition.title,
            icon: definition.icon,
          })),
        ],
      },
      primarySideBar: {
        ...workbenchConfig.primarySideBar,
        views: [...workbenchConfig.primarySideBar.views, ...primary.map((view) => view.id)],
      },
      secondarySideBar: {
        ...workbenchConfig.secondarySideBar,
        enabled: secondary.length > 0,
        views: secondary.map((view) => view.id),
      },
    },
    views: {
      primary: primaryViews,
      secondary: secondaryViews,
      panel: {},
    },
  }
}

function PanelSurface({ identity, panelId }: { identity: string; panelId: string }) {
  const runtime = useWorkspaceRuntime()
  const host = usePluginHost()
  const handles = useViewPoolSnapshot()
  const key = `panel:${identity}:${panelId}`
  const handle = handles.find((entry) => entry.key === key)
  const record = host.records.find((entry) => entry.identity === identity)
  const panel = record?.panels.find((entry) => entry.id === panelId)
  const current = useRef({ record, panel })
  current.current = { record, panel }

  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        runtime.views.detachPanelSurface(identity, panelId)
        return
      }
      const active = current.current
      if (!active.record || !active.panel) return
      runtime.views.attachPanelSurface(
        {
          plugin: pluginInfo(active.record),
          panel: {
            id: active.panel.id,
            title: active.panel.title,
            ...(active.panel.icon === undefined ? {} : { icon: active.panel.icon }),
            location: active.panel.location,
            entryUrl: active.panel.entryUrl,
          },
        },
        element,
      )
    },
    [identity, panelId, runtime],
  )

  if (!record || !panel) {
    return (
      <div className="exo-view-missing" role="status">
        This panel is no longer available.
      </div>
    )
  }

  return (
    <div className="exo-view-surface">
      {handle?.phase === 'failed' && (
        <div className="exo-view-error" role="alert">
          <span>{handle.error?.message ?? `The ${panel.title} panel could not start.`}</span>
          <button type="button" onClick={() => runtime.views.retry(key)}>
            Retry
          </button>
        </div>
      )}
      <div
        ref={attach}
        className="exo-view-placeholder"
        role="region"
        aria-label={`${panel.title} — ${record.manifest?.name ?? 'plugin'}`}
      />
    </div>
  )
}
