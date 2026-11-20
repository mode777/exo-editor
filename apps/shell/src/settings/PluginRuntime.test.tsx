import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginLog, RuntimeRow } from './PluginSettings'
import type { PluginHostRecord, PluginLogEntry } from '../plugins/host'

let root: Root | null = null
let container: HTMLDivElement | null = null

function record(overrides: Partial<PluginHostRecord> = {}): PluginHostRecord {
  return {
    manifestUrl: 'https://plugins.example.com/exo-manifest.json',
    entryIndex: 0,
    enabled: true,
    phase: 'loading',
    identity: 'https://plugins.example.com::com.example.test',
    consent: 'none',
    registrations: [],
    panels: [],
    contentViews: [],
    ...overrides,
  }
}

async function render(node: ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(node))
  return container
}

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function button(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent?.trim() === label,
    ) ?? null
  )
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('plugin runtime status row', () => {
  it('renders the not-loaded, disabled and loading states', async () => {
    let rendered = await render(
      <RuntimeRow record={undefined} onReview={vi.fn()} onRevoke={vi.fn()} />,
    )
    expect(rendered.textContent).toContain('Not loaded yet')
    await act(async () => root?.unmount())
    root = null
    container?.remove()

    rendered = await render(
      <RuntimeRow record={record({ phase: 'disabled' })} onReview={vi.fn()} onRevoke={vi.fn()} />,
    )
    expect(rendered.textContent).toContain('Disabled')
    await act(async () => root?.unmount())
    root = null
    container?.remove()

    rendered = await render(
      <RuntimeRow record={record({ phase: 'loading' })} onReview={vi.fn()} onRevoke={vi.fn()} />,
    )
    expect(rendered.textContent).toContain('Loading manifest')
  })

  it('shows awaiting consent and reviews it', async () => {
    const onReview = vi.fn()
    const rendered = await render(
      <RuntimeRow
        record={record({
          phase: 'awaiting-consent',
          manifest: {
            schemaVersion: 1,
            manifestUrl: 'https://plugins.example.com/exo-manifest.json',
            manifestOrigin: 'https://plugins.example.com',
            controllerUrl: 'https://plugins.example.com/plugin.html',
            pluginRoot: '/',
            id: 'com.example.test',
            name: 'Test Plugin',
            version: '1.0.0',
            publisher: { name: 'Test Publisher' },
            engines: { exo: '*' },
            permissions: ['workspace:read'],
            fileEditors: [],
            panels: [],
            contentViews: [],
          },
        })}
        onReview={onReview}
        onRevoke={vi.fn()}
      />,
    )
    expect(rendered.textContent).toContain('Awaiting consent')
    expect(rendered.textContent).toContain('Test Plugin 1.0.0')
    expect(rendered.textContent).toContain('Test Publisher')
    expect(rendered.textContent).toContain('https://plugins.example.com')
    click(button(rendered, 'Review consent'))
    expect(onReview).toHaveBeenCalledWith('https://plugins.example.com::com.example.test')
  })

  it('shows denial without an automatic action', async () => {
    const rendered = await render(
      <RuntimeRow
        record={record({ phase: 'denied', consent: 'denied' })}
        onReview={vi.fn()}
        onRevoke={vi.fn()}
      />,
    )
    expect(rendered.textContent).toContain('Consent denied for this session')
    expect(button(rendered, 'Review consent')).not.toBeNull()
  })

  it('shows active editors and requires a second click to revoke', async () => {
    const onRevoke = vi.fn()
    const rendered = await render(
      <RuntimeRow
        record={record({
          phase: 'active',
          consent: 'granted',
          registrations: [
            {
              glob: '**/*.ts',
              entry: 'editor.html',
              entryUrl: 'https://plugins.example.com/editor.html',
              label: 'Code',
              priority: 0,
              registrationOrder: 0,
            },
          ],
        })}
        onReview={vi.fn()}
        onRevoke={onRevoke}
      />,
    )
    expect(rendered.textContent).toContain('Active — Code')
    await act(async () => click(button(rendered, 'Revoke consent')))
    expect(onRevoke).not.toHaveBeenCalled()
    await act(async () => click(button(rendered, 'Confirm revoke')))
    expect(onRevoke).toHaveBeenCalledWith('https://plugins.example.com::com.example.test')
  })

  it('shows a failure code and phase', async () => {
    const rendered = await render(
      <RuntimeRow
        record={record({
          phase: 'failed',
          error: { code: 'cors', phase: 'manifest', message: 'Could not fetch the origin.' },
        })}
        onReview={vi.fn()}
        onRevoke={vi.fn()}
      />,
    )
    expect(rendered.textContent).toContain('Failed — cors (manifest)')
    expect(rendered.textContent).toContain('Could not fetch the origin.')
  })
})

describe('plugin log', () => {
  it('renders time, identity, phase and code without HTML', async () => {
    const entries: PluginLogEntry[] = [
      {
        at: 1000,
        manifestUrl: 'https://plugins.example.com/exo-manifest.json',
        pluginId: 'com.example.test',
        origin: 'https://plugins.example.com',
        phase: 'manifest',
        code: 'cors',
        message: '<img src=x onerror="window.pwned=1"> was not fetched',
      },
      {
        at: 2000,
        pluginId: 'com.example.test',
        phase: 'register',
        code: 'active',
      },
    ]
    const rendered = await render(<PluginLog entries={entries} />)
    const text = rendered.textContent ?? ''
    expect(text).toContain('com.example.test')
    expect(text).toContain('manifest')
    expect(text).toContain('cors')
    expect(text).toContain('register')
    expect(rendered.querySelector('img')).toBeNull()
  })

  it('renders nothing for an empty log', async () => {
    const rendered = await render(<PluginLog entries={[]} />)
    expect(rendered.textContent).toBe('')
  })
})
