import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspaceSession } from '../workspace/contract'
import type { NewFileView } from '../plugins/new-file'
import { NewFileDialog } from './NewFileDialog'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function makeSession(): Promise<WorkspaceSession> {
  const provider = new MemoryWorkspaceProvider({
    initialDirectories: ['/docs', '/.exo'],
    initialFiles: { '/notes.txt': 'old' },
  })
  return new Session(await provider.open())
}

function view(session: WorkspaceSession, overrides: Partial<NewFileView> = {}): NewFileView {
  return {
    kind: 'request',
    identity: 'https://plugins.example.com::com.example.plugin',
    pluginId: 'com.example.plugin',
    pluginName: 'Example Plugin',
    directory: '/',
    name: 'notes.md',
    size: 12,
    preview: '# Notes\nhello',
    binary: false,
    session,
    ...overrides,
  }
}

async function render(
  request: NewFileView,
  handlers: {
    onCancel?: () => void
    onSubmit?: (directory: string, name: string) => void
  } = {},
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <NewFileDialog
        request={request}
        onCancel={handlers.onCancel ?? vi.fn()}
        onSubmit={handlers.onSubmit ?? vi.fn()}
      />,
    ),
  )
  return container
}

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function button(rendered: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(rendered.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('new-file dialog', () => {
  it('names the plugin, shows the path, size and text preview, and hides reserved folders', async () => {
    const session = await makeSession()
    const rendered = await render(view(session))
    await vi.waitFor(() => expect(button(rendered, 'Create')).toBeDefined())
    const text = rendered.textContent ?? ''
    expect(text).toContain('Example Plugin')
    expect(text).toContain('/notes.md')
    expect(text).toContain('12 bytes')
    expect(text).toContain('# Notes')
    expect(text).not.toContain('.exo')
    expect(document.activeElement?.tagName).toBe('INPUT')
  })

  it('edits the name, navigates folders and submits the final path', async () => {
    const session = await makeSession()
    const onSubmit = vi.fn()
    const rendered = await render(view(session, { name: '' }), { onSubmit })
    await vi.waitFor(() => expect(rendered.textContent).toContain('docs'))

    await act(async () => click(button(rendered, '▸ docs/') ?? null))
    const input = rendered.querySelector('input') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'report.md')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rendered.textContent).toContain('/docs/report.md')
    await act(async () => click(button(rendered, 'Create') ?? null))
    expect(onSubmit).toHaveBeenCalledWith('/docs', 'report.md')
  })

  it('labels binary content without decoding it and cancels on Escape', async () => {
    const session = await makeSession()
    const onCancel = vi.fn()
    const rendered = await render(
      view(session, { binary: true, preview: undefined, name: 'image.png', size: 2048 }),
      { onCancel },
    )
    const text = rendered.textContent ?? ''
    expect(text).toContain('Binary content')
    expect(text).toContain('no preview is shown')
    expect(rendered.querySelector('pre')).toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('reports a collision without closing', async () => {
    const session = await makeSession()
    const rendered = await render(
      view(session, { error: '/notes.txt already exists.', name: 'notes.txt' }),
    )
    expect(rendered.textContent).toContain('/notes.txt already exists.')
    expect(rendered.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
