import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspaceSession } from '../workspace/contract'
import type { FilePickerView } from '../plugins/file-picker'
import { FilePickerDialog } from './FilePickerDialog'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function makeSession(
  files: Record<string, string> = {
    '/a.txt': 'a',
    '/b.txt': 'b',
    '/dir/c.txt': 'c',
    '/exo.json': '{}',
    '/.exo/state.json': '{"private":true}',
  },
): Promise<WorkspaceSession> {
  const provider = new MemoryWorkspaceProvider({ now: () => 1000, initialFiles: files })
  return new Session(await provider.open())
}

function view(session: WorkspaceSession, overrides: Partial<FilePickerView> = {}): FilePickerView {
  return {
    path: '/a.txt',
    pluginId: 'com.example.code',
    pluginName: 'Code Plugin',
    multiple: false,
    session,
    ...overrides,
  }
}

async function render(
  request: FilePickerView,
  handlers: {
    onCancel?: () => void
    onSelect?: (paths: string[]) => void
  } = {},
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <FilePickerDialog
        request={request}
        onCancel={handlers.onCancel ?? vi.fn()}
        onSelect={handlers.onSelect ?? vi.fn()}
      />,
    ),
  )
  return container
}

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function rows(rendered: HTMLElement): HTMLElement[] {
  return Array.from(rendered.querySelectorAll<HTMLElement>('[data-picker-row]'))
}

function row(rendered: HTMLElement, name: string): HTMLElement | undefined {
  return rows(rendered).find((element) => element.textContent?.includes(name))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('file picker dialog', () => {
  it('shows shell-owned disclosure and a bidi-safe workspace listing', async () => {
    const session = await makeSession()
    const rendered = await render(view(session))
    await vi.waitFor(() => expect(row(rendered, 'a.txt')).toBeDefined())
    const text = rendered.textContent ?? ''
    expect(text).toContain('Code Plugin')
    expect(text).toContain('com.example.code')
    expect(text).toContain('will be able to read the selected file')
    expect(text).not.toContain('exo.json')
    expect(text).not.toContain('.exo')
    expect(row(rendered, 'dir')).toBeDefined()
    expect(rendered.querySelectorAll('bdi').length).toBeGreaterThan(0)
    expect(document.activeElement?.hasAttribute('data-picker-row')).toBe(true)
  })

  it('navigates folders and returns selected file paths only', async () => {
    const session = await makeSession()
    const onSelect = vi.fn()
    const rendered = await render(view(session), { onSelect })
    await vi.waitFor(() => expect(row(rendered, 'a.txt')).toBeDefined())

    await act(async () => click(row(rendered, 'dir') ?? null))
    await vi.waitFor(() => expect(row(rendered, 'c.txt')).toBeDefined())
    await act(async () => click(row(rendered, 'c.txt') ?? null))
    const select = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent === 'Select',
    )
    await act(async () => click(select ?? null))
    expect(onSelect).toHaveBeenCalledWith(['/dir/c.txt'])
  })

  it('supports multiple selection and caps it at 32', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 34 }, (_, index) => [`/file-${index}.txt`, `${index}`]),
    )
    const session = await makeSession(files)
    const onSelect = vi.fn()
    const rendered = await render(view(session, { multiple: true }), { onSelect })
    await vi.waitFor(() => expect(row(rendered, 'file-0.txt')).toBeDefined())

    for (const element of rows(rendered).slice(0, 33)) {
      await act(async () => click(element))
    }
    expect(rendered.textContent).toContain('32 selected')
    const select = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent === 'Select',
    )
    await act(async () => click(select ?? null))
    expect(onSelect).toHaveBeenCalledOnce()
    expect((onSelect.mock.calls[0][0] as string[]).length).toBe(32)
  })

  it('uses a valid directory hint and falls back from a reserved or missing hint', async () => {
    const session = await makeSession()
    const hinted = await render(view(session, { directory: '/dir' }))
    await vi.waitFor(() => expect(row(hinted, 'c.txt')).toBeDefined())
    await act(async () => root?.unmount())
    root = null
    container?.remove()

    const reserved = await render(view(session, { directory: '/.exo' }))
    await vi.waitFor(() => expect(row(reserved, 'a.txt')).toBeDefined())
    expect(row(reserved, '.exo')).toBeUndefined()
    await act(async () => root?.unmount())
    root = null
    container?.remove()

    const missing = await render(view(session, { directory: '/missing' }))
    await vi.waitFor(() => expect(row(missing, 'a.txt')).toBeDefined())
    await act(async () => root?.unmount())
    root = null
    container?.remove()

    const traversal = await render(view(session, { directory: '../outside' }))
    await vi.waitFor(() => expect(row(traversal, 'a.txt')).toBeDefined())
  })

  it('cancels from Escape and keeps focus inside the modal', async () => {
    const session = await makeSession()
    const onCancel = vi.fn()
    const rendered = await render(view(session), { onCancel })
    await vi.waitFor(() => expect(row(rendered, 'a.txt')).toBeDefined())
    const dialog = rendered.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.contains(document.activeElement)).toBe(true)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
