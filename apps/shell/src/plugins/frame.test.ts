import { afterEach, describe, expect, it, vi } from 'vitest'
import { DomFrameTransport, type PluginMessage } from './frame'

afterEach(() => {
  document.body.innerHTML = ''
})

function emit(source: Window | null, origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
}

describe('DOM frame transport', () => {
  it('creates a hidden frame with the sandbox set before the source', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const transport = new DomFrameTransport({ container })
    const onMessage = vi.fn()
    const onLoadError = vi.fn()
    const frame = transport.open({
      url: 'https://plugins.example.com/monaco/plugin.html#exo-mode=register',
      sandbox: 'allow-scripts allow-same-origin',
      onMessage,
      onLoadError,
    })

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.hidden).toBe(true)
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(iframe?.getAttribute('allow')).toBe('')
    expect(iframe?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(iframe?.getAttribute('loading')).toBe('eager')
    expect(iframe?.hasAttribute('allowfullscreen')).toBe(false)
    expect(iframe?.getAttribute('allow-popups')).toBeNull()
    expect(iframe?.getAttribute('allow-top-navigation')).toBeNull()
    expect(iframe?.src).toBe('https://plugins.example.com/monaco/plugin.html#exo-mode=register')
    expect(frame.window).toBe(iframe?.contentWindow)
    expect(onLoadError).not.toHaveBeenCalled()
    transport.dispose()
  })

  it('routes only messages from the frame window', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const transport = new DomFrameTransport({ container })
    const messages: PluginMessage[] = []
    const frame = transport.open({
      url: 'https://plugins.example.com/plugin.html',
      sandbox: 'allow-scripts',
      onMessage: (message) => messages.push(message),
      onLoadError: vi.fn(),
    })

    emit(frame.window, 'https://plugins.example.com', { exo: 1 })
    expect(messages).toHaveLength(1)

    emit(window, 'https://plugins.example.com', { exo: 1 })
    expect(messages).toHaveLength(1)

    emit(null, 'https://plugins.example.com', { exo: 1 })
    expect(messages).toHaveLength(1)
    transport.dispose()
  })

  it('removes the iframe and route on idempotent close', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const transport = new DomFrameTransport({ container })
    const onMessage = vi.fn()
    const frame = transport.open({
      url: 'https://plugins.example.com/plugin.html',
      sandbox: 'allow-scripts',
      onMessage,
      onLoadError: vi.fn(),
    })
    const contentWindow = frame.window

    frame.close()
    frame.close()
    expect(container.querySelector('iframe')).toBeNull()
    emit(contentWindow, 'https://plugins.example.com', { exo: 1 })
    expect(onMessage).not.toHaveBeenCalled()
    transport.dispose()
  })

  it('reports a load error', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const transport = new DomFrameTransport({ container })
    const onLoadError = vi.fn()
    transport.open({
      url: 'https://plugins.example.com/plugin.html',
      sandbox: 'allow-scripts',
      onMessage: vi.fn(),
      onLoadError,
    })
    container.querySelector('iframe')?.dispatchEvent(new Event('error'))
    expect(onLoadError).toHaveBeenCalledTimes(1)
    transport.dispose()
  })

  it('shows and hides a visible handler surface without moving the iframe', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const transport = new DomFrameTransport({ container })
    const frame = transport.open({
      url: 'https://plugins.example.com/code/editor.html',
      sandbox: 'allow-scripts',
      visible: true,
      title: 'Exo Code editor',
      onMessage: vi.fn(),
      onLoadError: vi.fn(),
    })
    const surfaces = document.querySelector('[data-exo-plugin-surfaces]')
    const iframe = surfaces?.querySelector('iframe')
    expect(container.querySelector('iframe')).toBeNull()
    expect(iframe?.title).toBe('Exo Code editor')
    expect(iframe?.style.display).toBe('none')
    expect(frame.surface).toBeDefined()

    frame.surface?.show({ left: 10, top: 20, width: 800, height: 600 })
    expect(iframe?.style.left).toBe('10px')
    expect(iframe?.style.top).toBe('20px')
    expect(iframe?.style.width).toBe('800px')
    expect(iframe?.style.height).toBe('600px')
    expect(iframe?.style.display).toBe('block')
    expect(iframe?.getAttribute('aria-hidden')).toBe('false')
    expect(iframe?.tabIndex).toBe(0)

    frame.surface?.hide()
    expect(iframe?.style.display).toBe('none')
    expect(iframe?.getAttribute('aria-hidden')).toBe('true')
    expect(iframe?.tabIndex).toBe(-1)

    frame.close()
    expect(surfaces?.querySelector('iframe')).toBeNull()
    transport.dispose()
  })

  it('does not expose a surface for hidden frames', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const transport = new DomFrameTransport({ container })
    const frame = transport.open({
      url: 'https://plugins.example.com/plugin.html',
      sandbox: 'allow-scripts',
      onMessage: vi.fn(),
      onLoadError: vi.fn(),
    })
    expect(frame.surface).toBeUndefined()
    frame.close()
    transport.dispose()
  })
})
