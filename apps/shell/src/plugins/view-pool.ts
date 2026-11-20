import type { WorkspaceSession } from '../workspace/contract'
import { SHELL_VERSION } from '../version'
import { DomFrameTransport, type FrameTransport } from './frame'
import type { FilePickerOpenRequest, FilePickerOutcome } from './file-picker'
import type { NewFileOutcome, NewFileRequest } from './new-file'
import { EventBus, type ThemeName } from './events'
import type { PluginPermission } from './manifest'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  type IntentOutcome,
  type IntentSource,
  type OpenFileIntent,
  type OpenViewIntent,
  type PanelIntent,
  type PanelIntentOutcome,
} from './frame-session'
import { ViewSession, type ViewOpenedBy } from './view-session'
import type { PluginSettingsStore } from './settings'

export const MAX_CONTENT_VIEW_TABS = 10
export const MAX_PANEL_FRAMES = 8

export interface ViewPluginInfo {
  identity: string
  pluginId: string
  pluginName: string
  pluginVersion: string
  origin: string
  permissions: PluginPermission[]
}

export interface PanelViewInput {
  plugin: ViewPluginInfo
  panel: {
    id: string
    title: string
    icon?: string
    location: 'primary' | 'secondary'
    entryUrl: string
  }
}

export interface ContentViewInput {
  plugin: ViewPluginInfo
  view: {
    id: string
    title: string
    entryUrl: string
  }
  instanceKey: string
  payload?: unknown
  openedBy?: ViewOpenedBy
}

export type ViewHandleKind = 'panel' | 'content'
export type ViewHandlePhase = 'lazy' | 'mounting' | 'active' | 'failed' | 'closed'

export interface ViewHandle {
  key: string
  kind: ViewHandleKind
  identity: string
  pluginId: string
  pluginName: string
  viewId: string
  title: string
  entryUrl: string
  location?: 'primary' | 'secondary'
  instanceKey?: string
  phase: ViewHandlePhase
  visible: boolean
  error?: { code: string; phase: string; message?: string }
}

export type ContentOpenResult =
  | { ok: true; key: string; existing: boolean }
  | { ok: false; code: 'rate-limited' | 'internal'; message?: string }

export interface ViewPoolHost {
  logView(identity: string, phase: string, code?: string, message?: string): void
}

export interface ViewPoolAttachOptions {
  session: WorkspaceSession
  host: ViewPoolHost
  workspaceName: string
  settings?: PluginSettingsStore
}

export interface ViewPoolOptions {
  transport?: FrameTransport
  shellVersion?: string
  shellOrigin?: string
  theme?: () => ThemeName
  locale?: string
  createSessionId?: () => string
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  maxRequestBytes?: number
  events?: EventBus
  onRequestFiles?: (request: FilePickerOpenRequest) => Promise<FilePickerOutcome>
  onRequestNewFile?: (request: NewFileRequest) => Promise<NewFileOutcome>
  onOpenFile?: (request: OpenFileIntent, source: IntentSource) => Promise<IntentOutcome>
  onOpenView?: (request: OpenViewIntent, source: IntentSource) => Promise<IntentOutcome>
  onRequestPanel?: (request: PanelIntent, source: IntentSource) => Promise<PanelIntentOutcome>
}

interface ViewRecord {
  handle: ViewHandle
  input: PanelViewInput | ContentViewInput
  plugin: ViewPluginInfo
  session: ViewSession | null
  element: HTMLElement | null
  observer: ResizeObserver | null
}

function defaultTheme(): ThemeName {
  if (typeof document === 'undefined') return 'dark'
  const theme = document.documentElement.dataset.theme
  return theme === 'light' || theme === 'high-contrast' ? theme : 'dark'
}

function panelKey(identity: string, panelId: string): string {
  return `panel:${identity}:${panelId}`
}

export function contentViewKey(identity: string, viewId: string, instanceKey: string): string {
  return `content:${identity}:${viewId}:${instanceKey}`
}

/**
 * All panel and content-view frames for one workspace. Panels mount lazily on
 * first reveal and are retained hidden; content frames live for one open tab.
 * The pool owns the per-plugin caps, surface positioning and teardown order.
 */
export class ViewPool {
  readonly events: EventBus
  private readonly transport: FrameTransport
  private readonly ownsTransport: boolean
  private readonly shellVersion: string
  private readonly shellOrigin: string
  private readonly theme: () => ThemeName
  private readonly locale: string
  private readonly createSessionId: (() => string) | undefined
  private readonly setTimeoutImpl: typeof setTimeout | undefined
  private readonly clearTimeoutImpl: typeof clearTimeout | undefined
  private readonly maxRequestBytes: number
  private readonly onRequestFiles:
    ((request: FilePickerOpenRequest) => Promise<FilePickerOutcome>) | undefined
  private readonly onRequestNewFile:
    ((request: NewFileRequest) => Promise<NewFileOutcome>) | undefined
  private readonly onOpenFile:
    ((request: OpenFileIntent, source: IntentSource) => Promise<IntentOutcome>) | undefined
  private readonly onOpenView:
    ((request: OpenViewIntent, source: IntentSource) => Promise<IntentOutcome>) | undefined
  private readonly onRequestPanel:
    ((request: PanelIntent, source: IntentSource) => Promise<PanelIntentOutcome>) | undefined

  private readonly records = new Map<string, ViewRecord>()
  private attachOptions: ViewPoolAttachOptions | null = null
  private readonly listeners = new Set<() => void>()
  private snapshot: ViewHandle[] = []

  constructor(options: ViewPoolOptions = {}) {
    this.transport = options.transport ?? new DomFrameTransport()
    this.ownsTransport = options.transport === undefined
    this.events =
      options.events ??
      new EventBus({
        onSubscriberRemoved: (label, topic, code) =>
          this.attachOptions?.host.logView(label, 'view-events', code, topic),
      })
    this.shellVersion = options.shellVersion ?? SHELL_VERSION
    this.shellOrigin =
      options.shellOrigin ??
      (typeof location === 'undefined' ? 'http://localhost' : location.origin)
    this.theme = options.theme ?? defaultTheme
    this.locale =
      options.locale ?? (typeof navigator === 'undefined' ? 'en' : navigator.language || 'en')
    this.createSessionId = options.createSessionId
    this.setTimeoutImpl = options.setTimeoutImpl
    this.clearTimeoutImpl = options.clearTimeoutImpl
    this.maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES
    this.onRequestFiles = options.onRequestFiles
    this.onRequestNewFile = options.onRequestNewFile
    this.onOpenFile = options.onOpenFile
    this.onOpenView = options.onOpenView
    this.onRequestPanel = options.onRequestPanel
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleViewportResize)
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): ViewHandle[] => this.snapshot

  attach(options: ViewPoolAttachOptions): void {
    this.attachOptions = options
  }

  async detach(): Promise<void> {
    const sessions = [...this.records.values()]
    for (const key of [...this.records.keys()]) this.dropSurface(key)
    this.records.clear()
    this.attachOptions = null
    this.publish()
    await Promise.all(sessions.map((record) => record.session?.dispose('workspace-switch')))
  }

  handle(
    identity: string,
    kind: ViewHandleKind,
    viewId: string,
    instanceKey?: string,
  ): ViewHandle | undefined {
    if (kind === 'panel') return this.records.get(panelKey(identity, viewId))?.handle
    if (!instanceKey) return undefined
    return this.records.get(contentViewKey(identity, viewId, instanceKey))?.handle
  }

  panels(identity: string): ViewHandle[] {
    return this.snapshot.filter((handle) => handle.kind === 'panel' && handle.identity === identity)
  }

  contents(identity: string): ViewHandle[] {
    return this.snapshot.filter(
      (handle) => handle.kind === 'content' && handle.identity === identity,
    )
  }

  contentCount(identity: string): number {
    let total = 0
    for (const record of this.records.values()) {
      if (record.handle.kind === 'content' && record.handle.identity === identity) total += 1
    }
    return total
  }

  updateSettings(identity: string, values: Record<string, boolean | string | number>): boolean {
    let pluginId: string | undefined
    for (const record of this.records.values()) {
      if (record.handle.identity !== identity) continue
      pluginId = record.plugin.pluginId
      break
    }
    if (!pluginId) return false
    this.events.publish('config/changed', { pluginId, values }, { target: identity })
    return true
  }

  /**
   * Mount a panel on first reveal and attach its shell-owned placeholder. A
   * later call reuses the same frame and only updates the position.
   */
  attachPanelSurface(input: PanelViewInput, element: HTMLElement | null): void {
    if (!element) {
      this.detachPanelSurface(input.plugin.identity, input.panel.id)
      return
    }
    const record = this.ensurePanel(input)
    if (!record) return
    this.attachElement(record.handle.key, element)
  }

  detachPanelSurface(identity: string, panelId: string): void {
    const key = panelKey(identity, panelId)
    const record = this.records.get(key)
    if (!record) return
    this.dropSurface(key)
    record.handle.visible = false
    this.publish()
  }

  openContent(input: ContentViewInput): ContentOpenResult {
    if (!this.attachOptions) {
      return { ok: false, code: 'internal', message: 'No workspace is attached.' }
    }
    const key = contentViewKey(input.plugin.identity, input.view.id, input.instanceKey)
    if (this.records.has(key)) {
      return { ok: true, key, existing: true }
    }
    if (this.contentCount(input.plugin.identity) >= MAX_CONTENT_VIEW_TABS) {
      return {
        ok: false,
        code: 'rate-limited',
        message: `A plugin may open at most ${MAX_CONTENT_VIEW_TABS} content-view tabs.`,
      }
    }
    const handle: ViewHandle = {
      key,
      kind: 'content',
      identity: input.plugin.identity,
      pluginId: input.plugin.pluginId,
      pluginName: input.plugin.pluginName,
      viewId: input.view.id,
      title: input.view.title,
      entryUrl: input.view.entryUrl,
      instanceKey: input.instanceKey,
      phase: 'mounting',
      visible: false,
    }
    const record: ViewRecord = {
      handle,
      input,
      plugin: input.plugin,
      session: null,
      element: null,
      observer: null,
    }
    this.records.set(key, record)
    this.publish()
    this.mount(record, {
      kind: 'content',
      id: input.view.id,
      title: input.view.title,
      entryUrl: input.view.entryUrl,
      instanceId: key,
      payload: input.payload,
      openedBy: input.openedBy,
    })
    return { ok: true, key, existing: false }
  }

  attachContentSurface(key: string, element: HTMLElement | null): void {
    if (!element) {
      this.dropSurface(key)
      const record = this.records.get(key)
      if (record) {
        record.handle.visible = false
        this.publish()
      }
      return
    }
    this.attachElement(key, element)
  }

  closeContent(
    key: string,
    reason: 'closed' | 'workspace-switch' | 'plugin-removed' | 'error' = 'closed',
  ): void {
    const record = this.records.get(key)
    if (!record) return
    this.dropSurface(key)
    this.records.delete(key)
    record.handle.phase = 'closed'
    this.attachOptions?.host.logView(
      record.handle.identity,
      'view-dispose',
      reason,
      record.handle.viewId,
    )
    void record.session?.dispose(reason)
    this.publish()
  }

  /** Recreate a failed panel or content frame with its original input. */
  retry(key: string): void {
    const record = this.records.get(key)
    if (!record || record.handle.phase !== 'failed') return
    this.dropSurface(key)
    record.session?.close()
    record.session = null
    record.handle.phase = 'mounting'
    record.handle.error = undefined
    record.handle.visible = false
    this.publish()
    this.mountRecord(record)
  }

  closeFor(
    identity: string,
    reason: 'closed' | 'workspace-switch' | 'plugin-removed' | 'error',
  ): void {
    for (const [key, record] of [...this.records]) {
      if (record.handle.identity !== identity) continue
      this.dropSurface(key)
      this.records.delete(key)
      record.handle.phase = 'closed'
      void record.session?.dispose(reason)
    }
    this.publish()
  }

  async disposeAll(
    reason: 'closed' | 'workspace-switch' | 'plugin-removed' | 'error',
  ): Promise<void> {
    const sessions = [...this.records.values()]
    for (const key of [...this.records.keys()]) this.dropSurface(key)
    this.records.clear()
    this.publish()
    await Promise.all(sessions.map((record) => record.session?.dispose(reason)))
  }

  /** Session for a mounted panel, used by command delivery; absent until reveal. */
  panelSession(identity: string, panelId: string): ViewSession | undefined {
    return this.records.get(panelKey(identity, panelId))?.session ?? undefined
  }

  contentSession(key: string): ViewSession | undefined {
    return this.records.get(key)?.session ?? undefined
  }

  /** Wait for a revealed panel's frame to become active. */
  waitForPanel(identity: string, panelId: string, timeoutMs = 5_000): Promise<ViewSession | null> {
    return this.waitForSession(panelKey(identity, panelId), timeoutMs)
  }

  /** Wait for an opened content-view frame to become active. */
  waitForContent(key: string, timeoutMs = 5_000): Promise<ViewSession | null> {
    return this.waitForSession(key, timeoutMs)
  }

  private waitForSession(key: string, timeoutMs: number): Promise<ViewSession | null> {
    const current = this.records.get(key)
    if (current?.session?.active) return Promise.resolve(current.session)
    if (current && (current.handle.phase === 'failed' || current.handle.phase === 'closed')) {
      return Promise.resolve(null)
    }
    // The record may not exist yet: a reveal schedules a React render that
    // attaches the surface. Wait for it instead of failing the invocation.
    return new Promise<ViewSession | null>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let off: () => void = () => undefined
      const finish = (session: ViewSession | null) => {
        if (settled) return
        settled = true
        if (timer !== null) (this.clearTimeoutImpl ?? clearTimeout)(timer)
        off()
        resolve(session)
      }
      off = this.subscribe(() => {
        const record = this.records.get(key)
        if (record?.session?.active) {
          finish(record.session)
          return
        }
        if (record && (record.handle.phase === 'failed' || record.handle.phase === 'closed')) {
          finish(null)
        }
      })
      timer = (this.setTimeoutImpl ?? setTimeout)(() => finish(null), timeoutMs)
    })
  }

  disposeTransport(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleViewportResize)
    }
    for (const key of [...this.records.keys()]) this.dropSurface(key)
    if (this.ownsTransport) this.transport.dispose?.()
  }

  private ensurePanel(input: PanelViewInput): ViewRecord | null {
    if (!this.attachOptions) return null
    const key = panelKey(input.plugin.identity, input.panel.id)
    const existing = this.records.get(key)
    if (existing) return existing
    let mounted = 0
    for (const record of this.records.values()) {
      if (record.handle.kind === 'panel' && record.handle.identity === input.plugin.identity) {
        mounted += 1
      }
    }
    if (mounted >= MAX_PANEL_FRAMES) return null
    const handle: ViewHandle = {
      key,
      kind: 'panel',
      identity: input.plugin.identity,
      pluginId: input.plugin.pluginId,
      pluginName: input.plugin.pluginName,
      viewId: input.panel.id,
      title: input.panel.title,
      entryUrl: input.panel.entryUrl,
      location: input.panel.location,
      phase: 'mounting',
      visible: false,
    }
    const record: ViewRecord = {
      handle,
      input,
      plugin: input.plugin,
      session: null,
      element: null,
      observer: null,
    }
    this.records.set(key, record)
    this.publish()
    this.mount(record, {
      kind: 'panel',
      id: input.panel.id,
      title: input.panel.title,
      location: input.panel.location,
      entryUrl: input.panel.entryUrl,
      instanceId: key,
    })
    return record
  }

  private mount(
    record: ViewRecord,
    view: {
      kind: 'panel' | 'content'
      id: string
      title: string
      entryUrl: string
      instanceId: string
      location?: 'primary' | 'secondary'
      payload?: unknown
      openedBy?: ViewOpenedBy
    },
  ): void {
    const attached = this.attachOptions
    if (!attached) return
    const session = new ViewSession({
      plugin: record.plugin,
      entryUrl: view.entryUrl,
      view: {
        kind: view.kind,
        id: view.id,
        title: view.title,
        instanceId: view.instanceId,
        ...(view.location === undefined ? {} : { location: view.location }),
        ...(view.payload === undefined ? {} : { payload: view.payload }),
        ...(view.openedBy === undefined ? {} : { openedBy: view.openedBy }),
      },
      session: attached.session,
      transport: this.transport,
      shellVersion: this.shellVersion,
      shellOrigin: this.shellOrigin,
      workspaceName: attached.workspaceName,
      theme: this.theme(),
      locale: this.locale,
      events: this.events,
      settings: attached.settings?.values(record.plugin.identity) ?? {},
      maxFileSize: attached.session.capabilities().maxFileSize ?? DEFAULT_MAX_REQUEST_BYTES,
      maxRequestBytes: this.maxRequestBytes,
      createSessionId: this.createSessionId,
      setTimeoutImpl: this.setTimeoutImpl,
      clearTimeoutImpl: this.clearTimeoutImpl,
      onActive: () => {
        record.handle.phase = 'active'
        record.handle.error = undefined
        this.updateSurface(record.handle.key)
        this.publish()
      },
      onRequestFiles: this.onRequestFiles,
      onRequestNewFile: (request) => {
        if (!record.handle.visible || !record.session?.active || !record.session?.hasFocus()) {
          return Promise.resolve({ ok: false as const, code: 'permission-denied' as const })
        }
        return (
          this.onRequestNewFile?.(request) ??
          Promise.resolve({ ok: false as const, code: 'internal' as const })
        )
      },
      onFailure: (failure) => {
        record.handle.phase = 'failed'
        record.handle.error = {
          code: failure.code,
          phase: failure.phase,
          message: failure.message,
        }
        this.attachOptions?.host.logView(
          record.handle.identity,
          'view-failed',
          failure.code,
          failure.message ?? failure.phase,
        )
        this.updateSurface(record.handle.key)
        this.publish()
      },
      onLog: (event) => {
        this.attachOptions?.host.logView(
          record.handle.identity,
          event.phase,
          event.code,
          event.message,
        )
      },
      onOpenFile: this.onOpenFile
        ? (request) =>
            this.onOpenFile?.(request, record.plugin) ??
            Promise.resolve({ ok: false as const, code: 'unsupported-message' as const })
        : undefined,
      onOpenView: this.onOpenView
        ? (request) =>
            this.onOpenView?.(request, record.plugin) ??
            Promise.resolve({ ok: false as const, code: 'unsupported-message' as const })
        : undefined,
      onRequestPanel: this.onRequestPanel
        ? (request) =>
            this.onRequestPanel?.(request, record.plugin) ??
            Promise.resolve({ ok: false as const, code: 'unsupported-message' as const })
        : undefined,
      isVisible: () => record.handle.visible,
    })
    record.session = session
    this.attachOptions?.host.logView(record.handle.identity, 'view-open', undefined, view.id)
    session.start()
  }

  private mountRecord(record: ViewRecord): void {
    const input = record.input
    if ('panel' in input) {
      this.mount(record, {
        kind: 'panel',
        id: input.panel.id,
        title: input.panel.title,
        location: input.panel.location,
        entryUrl: input.panel.entryUrl,
        instanceId: record.handle.key,
      })
      return
    }
    this.mount(record, {
      kind: 'content',
      id: input.view.id,
      title: input.view.title,
      entryUrl: input.view.entryUrl,
      instanceId: record.handle.key,
      payload: input.payload,
      openedBy: input.openedBy,
    })
  }

  private attachElement(key: string, element: HTMLElement): void {
    const record = this.records.get(key)
    if (!record) return
    record.observer?.disconnect()
    record.element = element
    record.handle.visible = true
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.updateSurface(key))
      observer.observe(element)
      record.observer = observer
    }
    this.publish()
    this.updateSurface(key)
  }

  private handleViewportResize = (): void => {
    for (const key of this.records.keys()) this.updateSurface(key)
  }

  private updateSurface(key: string): void {
    const record = this.records.get(key)
    if (!record?.session?.active || !record.element || !record.handle.visible) {
      record?.session?.surface?.hide()
      return
    }
    const rect = record.element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      record.session?.surface?.hide()
      return
    }
    record.session?.surface?.show({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })
  }

  private dropSurface(key: string): void {
    const record = this.records.get(key)
    if (!record) return
    record.observer?.disconnect()
    record.observer = null
    record.element = null
    record.handle.visible = false
    record.session?.surface?.hide()
  }

  private publish(): void {
    this.snapshot = [...this.records.values()].map((record) => ({
      ...record.handle,
      ...(record.handle.error ? { error: { ...record.handle.error } } : {}),
    }))
    for (const listener of [...this.listeners]) listener()
  }
}
