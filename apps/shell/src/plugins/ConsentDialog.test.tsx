import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsentDialog, type ConsentRequestView } from './ConsentDialog'
import type { PluginManifest } from './manifest'

const SHELL_ORIGIN = 'https://editor.example.com'

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    manifestUrl: 'https://plugins.example.com/monaco/exo-manifest.json',
    manifestOrigin: 'https://plugins.example.com',
    controllerUrl: 'https://plugins.example.com/monaco/plugin.html',
    pluginRoot: '/monaco/',
    id: 'com.example.monaco',
    name: 'Monaco Code Editor',
    version: '1.2.0',
    publisher: { name: 'Example Corp', url: 'https://example.com' },
    homepage: 'https://example.com/monaco',
    engines: { exo: '^0.1.0' },
    permissions: ['workspace:read', 'workspace:write'],
    fileEditors: [
      {
        glob: '**/*.ts',
        entry: 'editors/code.html',
        entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
        label: 'Code',
        priority: 10,
      },
    ],
    ...overrides,
  }
}

function request(overrides: Partial<PluginManifest> = {}): ConsentRequestView {
  return {
    identity: 'https://plugins.example.com::com.example.monaco',
    manifest: manifest(overrides),
    fingerprint: 'v1:abc',
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(
  view: ConsentRequestView | null,
  options: {
    onApprove?: (identity: string) => void
    onDeny?: (identity: string) => void
    shellOrigin?: string
  } = {},
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onApprove = options.onApprove ?? vi.fn()
  const onDeny = options.onDeny ?? vi.fn()
  await act(async () =>
    root?.render(
      <ConsentDialog
        request={view}
        shellOrigin={options.shellOrigin ?? SHELL_ORIGIN}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    ),
  )
  return { container, onApprove, onDeny }
}

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function mouseDown(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('consent dialog', () => {
  it('shows the exact origin, controller, root, editors and permissions', async () => {
    const { container: rendered } = await render(request())
    const text = rendered.textContent ?? ''
    expect(text).toContain('Monaco Code Editor')
    expect(text).toContain('com.example.monaco')
    expect(text).toContain('1.2.0')
    expect(text).toContain('Example Corp')
    expect(text).toContain('https://plugins.example.com')
    expect(text).toContain('https://plugins.example.com/monaco/plugin.html')
    expect(text).toContain('https://plugins.example.com/monaco/')
    expect(text).toContain('Code')
    expect(text).toContain('**/*.ts')
    expect(text).toContain('workspace:read')
    expect(text).toContain('workspace:write')
    expect(text).toContain('can write to your workspace')
    expect(text).not.toContain('same origin as the shell')
  })

  it('warns when the plugin shares the shell origin', async () => {
    const sameOrigin = request({
      manifestOrigin: SHELL_ORIGIN,
      manifestUrl: `${SHELL_ORIGIN}/plugin-host-fixture/exo-manifest.json`,
      controllerUrl: `${SHELL_ORIGIN}/plugin-host-fixture/plugin.html`,
      pluginRoot: '/plugin-host-fixture/',
    })
    const { container: rendered } = await render(sameOrigin)
    expect(rendered.textContent).toContain('same origin as the shell')
    expect(rendered.textContent).toContain('cannot be isolated by origin')
  })

  it('renders a safe homepage link only when present', async () => {
    const { container: rendered } = await render(request())
    const link = rendered.querySelector<HTMLAnchorElement>('a[href="https://example.com/monaco"]')
    expect(link?.rel).toBe('noopener noreferrer')
    expect(link?.target).toBe('_blank')

    const noHomepage = request({ homepage: undefined })
    await act(async () => root?.unmount())
    root = null
    container?.remove()
    const second = await render(noHomepage)
    expect(second.container.querySelector('a')).toBeNull()
  })

  it('starts focus on Deny', async () => {
    await render(request())
    expect(document.activeElement?.textContent).toBe('Deny')
  })

  it('denies on Escape and on a backdrop click, not on an inner click', async () => {
    const { container: rendered, onDeny, onApprove } = await render(request())
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onDeny).toHaveBeenCalledWith('https://plugins.example.com::com.example.monaco')
    expect(onApprove).not.toHaveBeenCalled()

    vi.mocked(onDeny).mockClear()
    mouseDown(rendered.querySelector('[data-testid="consent-backdrop"]'))
    expect(onDeny).toHaveBeenCalledTimes(1)

    vi.mocked(onDeny).mockClear()
    mouseDown(rendered.querySelector('[role="dialog"]'))
    expect(onDeny).not.toHaveBeenCalled()
  })

  it('approves only from the explicit button', async () => {
    const { container: rendered, onApprove } = await render(request())
    const allow = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent === 'Allow plugin',
    )
    click(allow ?? null)
    expect(onApprove).toHaveBeenCalledWith('https://plugins.example.com::com.example.monaco')
  })

  it('renders plugin strings as text, not HTML', async () => {
    const hostile = request({
      name: '<img src=x onerror="window.pwned=1">',
      publisher: { name: '<script>window.pwned=1</script>' },
    })
    const { container: rendered } = await render(hostile)
    expect(rendered.querySelector('img')).toBeNull()
    expect(rendered.querySelector('script')).toBeNull()
    expect(rendered.textContent).toContain('<img src=x')
  })

  it('renders nothing when there is no request', async () => {
    const { container: rendered } = await render(null)
    expect(rendered.querySelector('[role="dialog"]')).toBeNull()
  })
})
