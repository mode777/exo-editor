import { useCallback, useRef } from 'react'
import {
  useWorkbenchStore,
  type ViewDefinition,
  type WorkbenchConfig,
  type WorkbenchViewRegistry,
} from 'vscode-workbench'
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

interface PanelEntry {
  identity: string
  record: PluginHostRecord
  panel: RegisteredPanel
}

function panelDefinition(entry: PanelEntry, bottomViewIds: string[]): ViewDefinition {
  const { identity, record, panel } = entry
  const id = pluginViewId(identity, panel.id)
  const definition: ViewDefinition = {
    id,
    title: `${panel.title} — ${record.manifest?.name ?? 'Plugin'}`,
    icon: panel.icon ?? 'window',
    component: () => (
      <PanelSurface
        identity={identity}
        panelId={panel.id}
        {...(panel.location === 'bottom' ? { bottomViewIds } : {})}
      />
    ),
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

/** Derive the activity bar, all three view registries and the views from the host. */
export function derivePluginWorkbench(host: PluginHostSnapshot): {
  config: WorkbenchConfig
  views: WorkbenchViewRegistry
} {
  const entries: PanelEntry[] = []
  for (const record of host.records) {
    if (record.phase !== 'active' || !record.manifest || !record.identity) continue
    for (const panel of record.panels) {
      entries.push({ identity: record.identity, record, panel })
    }
  }

  const bottomViewIds = entries
    .filter((entry) => entry.panel.location === 'bottom')
    .map((entry) => pluginViewId(entry.identity, entry.panel.id))
  const primary: ViewDefinition[] = []
  const secondary: ViewDefinition[] = []
  const bottom: ViewDefinition[] = []
  for (const entry of entries) {
    const definition = panelDefinition(entry, bottomViewIds)
    if (entry.panel.location === 'primary') primary.push(definition)
    else if (entry.panel.location === 'secondary') secondary.push(definition)
    else bottom.push(definition)
  }

  const primaryViews: Record<string, ViewDefinition> = { ...workbenchViews.primary }
  for (const definition of primary) primaryViews[definition.id] = definition
  const secondaryViews: Record<string, ViewDefinition> = {}
  for (const definition of secondary) secondaryViews[definition.id] = definition
  const panelViews: Record<string, ViewDefinition> = {}
  for (const definition of bottom) panelViews[definition.id] = definition

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
      bottomPanel: {
        ...workbenchConfig.bottomPanel,
        enabled: bottom.length > 0,
        views: bottom.map((view) => view.id),
      },
    },
    views: {
      primary: primaryViews,
      secondary: secondaryViews,
      panel: panelViews,
    },
  }
}

function PanelSurface({
  identity,
  panelId,
  bottomViewIds,
}: {
  identity: string
  panelId: string
  /** Ordered bottom view ids; present only for a bottom panel. */
  bottomViewIds?: string[]
}) {
  const runtime = useWorkspaceRuntime()
  const host = usePluginHost()
  const handles = useViewPoolSnapshot()
  const activePanelView = useWorkbenchStore((state) => state.activePanelView)
  const key = `panel:${identity}:${panelId}`
  const id = pluginViewId(identity, panelId)
  const activeBottomView =
    bottomViewIds === undefined || bottomViewIds.length === 0
      ? null
      : bottomViewIds.includes(activePanelView)
        ? activePanelView
        : bottomViewIds[0]
  const shown = bottomViewIds === undefined || activeBottomView === id
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
      {shown && handle?.phase === 'failed' && (
        <div className="exo-view-error" role="alert">
          <span>{handle.error?.message ?? `The ${panel.title} panel could not start.`}</span>
          <button type="button" onClick={() => runtime.views.retry(key)}>
            Retry
          </button>
        </div>
      )}
      {shown && (
        <div
          ref={attach}
          className="exo-view-placeholder"
          role="region"
          aria-label={`${panel.title} — ${record.manifest?.name ?? 'plugin'}`}
        />
      )}
    </div>
  )
}
