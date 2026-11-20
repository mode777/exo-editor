import type { WorkspaceSession } from '../workspace/contract'
import type { FrameTransport } from './frame'
import type { FilePickerOpenRequest, FilePickerOutcome } from './file-picker'
import type { NewFileOutcome, NewFileRequest } from './new-file'
import type { EventBus } from './events'
import type { SettingValues } from './settings'
import {
  FrameSession,
  type FrameSessionOptions,
  type FrameSessionPlugin,
  type IntentOutcome,
  type OpenFileIntent,
  type OpenViewIntent,
  type PanelIntent,
  type PanelIntentOutcome,
  type SessionFailure,
  type SessionLogEvent,
} from './frame-session'
import type { Envelope } from './protocol'

export interface ViewOpenedBy {
  pluginId: string
  pluginName: string
  origin: string
}

export interface ViewInitData {
  kind: 'panel' | 'content'
  id: string
  title: string
  instanceId: string
  /** Present for a panel. */
  location?: 'primary' | 'secondary'
  /** One-shot data supplied by the opener; never file content. */
  payload?: unknown
  openedBy?: ViewOpenedBy
}

export interface ViewSessionOptions {
  plugin: FrameSessionPlugin
  entryUrl: string
  view: ViewInitData
  session: WorkspaceSession
  transport: FrameTransport
  shellVersion: string
  shellOrigin: string
  workspaceName: string
  theme: 'dark' | 'light' | 'high-contrast'
  locale: string
  events: EventBus
  settings?: SettingValues
  maxFileSize: number
  maxRequestBytes: number
  createSessionId?: () => string
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  onActive?: () => void
  onRequestFiles?: (request: FilePickerOpenRequest) => Promise<FilePickerOutcome>
  onRequestNewFile?: (request: NewFileRequest) => Promise<NewFileOutcome>
  onFailure: (failure: SessionFailure) => void
  onLog?: (event: SessionLogEvent) => void
  onOpenFile?: (request: OpenFileIntent) => Promise<IntentOutcome>
  onOpenView?: (request: OpenViewIntent) => Promise<IntentOutcome>
  onRequestPanel?: (request: PanelIntent) => Promise<PanelIntentOutcome>
  isVisible?: () => boolean
}

/**
 * One panel or content-view frame. It has no file, dirty state or save path;
 * the shared read, picker, list, event, intent and disposal logic is inherited.
 */
export class ViewSession extends FrameSession {
  readonly mode = 'view' as const

  private readonly viewOptions: ViewSessionOptions

  constructor(options: ViewSessionOptions) {
    const shared: FrameSessionOptions = {
      plugin: options.plugin,
      session: options.session,
      transport: options.transport,
      shellVersion: options.shellVersion,
      shellOrigin: options.shellOrigin,
      workspaceName: options.workspaceName,
      theme: options.theme,
      locale: options.locale,
      events: options.events,
      settings: options.settings,
      maxFileSize: options.maxFileSize,
      maxRequestBytes: options.maxRequestBytes,
      readBasePath: null,
      createSessionId: options.createSessionId,
      setTimeoutImpl: options.setTimeoutImpl,
      clearTimeoutImpl: options.clearTimeoutImpl,
      onActive: options.onActive,
      onRequestFiles: options.onRequestFiles,
      onRequestNewFile: options.onRequestNewFile,
      onFailure: (failure) => options.onFailure(failure),
      onLog: options.onLog,
      onOpenFile: options.onOpenFile,
      onOpenView: options.onOpenView,
      onRequestPanel: options.onRequestPanel,
      isVisible: options.isVisible,
      writeCapability:
        options.session.capabilities().writable &&
        options.plugin.permissions.includes('workspace:write'),
    }
    super(shared)
    this.viewOptions = options
  }

  get view(): ViewInitData {
    return { ...this.viewOptions.view }
  }

  start(): void {
    this.mountFrame({
      entryUrl: this.viewOptions.entryUrl,
      visible: true,
      title: `${this.viewOptions.view.title} — ${this.plugin.pluginName}`,
    })
  }

  protected buildModeInit(): Record<string, unknown> {
    const view = this.viewOptions.view
    return {
      view: {
        kind: view.kind,
        id: view.id,
        title: view.title,
        instanceId: view.instanceId,
        ...(view.location === undefined ? {} : { location: view.location }),
        ...(view.payload === undefined ? {} : { payload: view.payload }),
        ...(view.openedBy === undefined ? {} : { openedBy: { ...view.openedBy } }),
      },
    }
  }

  protected handleModeMessage(envelope: Envelope): boolean {
    // Editor-only messages are never valid in a view frame.
    if (
      envelope.type === 'plugin/dirty' ||
      envelope.type === 'plugin/request-save' ||
      envelope.type === 'plugin/save-content'
    ) {
      this.violation(envelope)
      return true
    }
    return false
  }
}
