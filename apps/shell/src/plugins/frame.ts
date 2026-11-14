/**
 * The frame boundary. The host never touches an iframe directly; it opens a
 * transport frame and receives source-routed messages. Tests use a fake with
 * the same shape, so origin and sandbox rules are exercised without a browser
 * cross-origin frame.
 */

export type FrameSandbox = 'allow-scripts' | 'allow-scripts allow-same-origin'

export interface PluginMessage {
  data: unknown
  origin: string
  source: Window | null
}

export interface FrameOpenOptions {
  url: string
  sandbox: FrameSandbox
  onMessage: (event: PluginMessage) => void
  onLoadError: () => void
}

export interface FrameHandle {
  readonly window: Window | null
  close(): void
}

export interface FrameTransport {
  open(options: FrameOpenOptions): FrameHandle
  dispose?(): void
}

export class DomFrameTransport implements FrameTransport {
  private readonly document: Document
  private readonly container: HTMLElement
  private readonly routes = new Map<Window, (event: PluginMessage) => void>()
  private listening = false

  constructor(options: { document?: Document; container?: HTMLElement } = {}) {
    this.document = options.document ?? document
    if (options.container) {
      this.container = options.container
    } else {
      const container = this.document.createElement('div')
      container.className = 'exo-plugin-frames'
      container.hidden = true
      this.document.body.appendChild(container)
      this.container = container
    }
  }

  open(options: FrameOpenOptions): FrameHandle {
    const iframe = this.document.createElement('iframe')
    // Set the sandbox before the source so the first document cannot escape it.
    iframe.setAttribute('sandbox', options.sandbox)
    iframe.setAttribute('allow', '')
    iframe.hidden = true
    iframe.title = 'Exo plugin frame'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.referrerPolicy = 'no-referrer'
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.loading = 'eager'
    iframe.setAttribute('loading', 'eager')
    const onError = () => options.onLoadError()
    iframe.addEventListener('error', onError)
    this.container.appendChild(iframe)
    iframe.src = options.url

    const contentWindow = iframe.contentWindow
    if (contentWindow) {
      this.routes.set(contentWindow, options.onMessage)
      this.installListener()
    }

    let closed = false
    return {
      window: contentWindow,
      close: () => {
        if (closed) return
        closed = true
        if (contentWindow) this.routes.delete(contentWindow)
        iframe.removeEventListener('error', onError)
        iframe.remove()
      },
    }
  }

  dispose(): void {
    this.routes.clear()
    if (!this.listening) return
    this.listening = false
    this.document.defaultView?.removeEventListener('message', this.handleMessage)
  }

  private installListener(): void {
    if (this.listening) return
    this.listening = true
    this.document.defaultView?.addEventListener('message', this.handleMessage)
  }

  private handleMessage = (event: MessageEvent): void => {
    if (!event.source) return
    const handler = this.routes.get(event.source as Window)
    if (!handler) return
    handler({
      data: event.data,
      origin: event.origin,
      source: event.source as Window,
    })
  }
}
