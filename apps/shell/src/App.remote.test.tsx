import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { WorkspaceRuntime } from './workspace/runtime'
import { MemoryWorkspaceProvider } from './workspace/providers/memory'
import { MemoryHandleStore } from './workspace/providers/folder/handle-store'
import { MemoryActiveWorkspaceStore } from './workspace/providers/active-store'
import { MemoryConnectionStore } from './workspace/providers/stratofold/connection-store'
import { FAKE_TOKEN, FakeStratofoldServer } from './workspace/providers/stratofold/fake-server'
import { configurePresetStore, clearWorkspaceTabs } from './workbench/tabs'
import { requestRemoteConnect } from './workspace/connect-bus'

interface Mounted {
  runtime: WorkspaceRuntime
  server: FakeStratofoldServer
  container: HTMLElement
  root: Root
}

async function mount(server = new FakeStratofoldServer({ initialFiles: { 'a.txt': 'one' } })) {
  const runtime = new WorkspaceRuntime({
    providerFactory: () => new MemoryWorkspaceProvider({ initialFiles: { '/a.txt': 'one' } }),
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    activeStore: new MemoryActiveWorkspaceStore(),
    connectionStore: new MemoryConnectionStore(),
    connectSeams: { fetch: server.fetch, createXhr: server.createXhr },
    eventTarget: new EventTarget(),
    now: () => 1,
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  return { runtime, server, container, root }
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

function setValue(element: HTMLInputElement | null, value: string) {
  if (!element) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function connectThroughDialog(mounted: Mounted, token = FAKE_TOKEN, remember = false) {
  click(button(mounted.container, 'Connect Remote…'))
  await vi.waitFor(() =>
    expect(mounted.container.querySelector('#exo-connect-server')).not.toBeNull(),
  )
  await act(async () => {
    setValue(
      mounted.container.querySelector<HTMLInputElement>('#exo-connect-server'),
      mounted.server.baseUrl,
    )
    setValue(mounted.container.querySelector<HTMLInputElement>('#exo-connect-token'), token)
    const checkbox = mounted.container.querySelector<HTMLInputElement>('#exo-connect-remember')
    if (checkbox && remember) click(checkbox)
  })
  await act(async () => {
    click(button(mounted.container, 'Connect'))
  })
  await vi.waitFor(() => expect(mounted.container.querySelector('#exo-connect-server')).toBeNull())
}

describe('remote workspace ui', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('connects through the dialog without rendering the token', async () => {
    const mounted = await mount()
    try {
      await vi.waitFor(() => expect(button(mounted.container, 'Connect Remote…')).not.toBeNull())
      await connectThroughDialog(mounted, FAKE_TOKEN, true)

      await vi.waitFor(() => expect(mounted.container.textContent).toContain('a.txt'))
      expect(mounted.runtime.getSnapshot()).toMatchObject({
        phase: 'ready',
        remote: { name: 'demo', remembered: true, rejected: false },
      })
      expect(mounted.container.innerHTML).not.toContain(FAKE_TOKEN)
      expect(mounted.container.querySelector('.exo-reconnect-banner')).toBeNull()
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('shows a validation failure in the dialog and opens nothing', async () => {
    const mounted = await mount()
    try {
      await vi.waitFor(() => expect(button(mounted.container, 'Connect Remote…')).not.toBeNull())
      click(button(mounted.container, 'Connect Remote…'))
      await vi.waitFor(() =>
        expect(mounted.container.querySelector('#exo-connect-server')).not.toBeNull(),
      )
      await act(async () => {
        setValue(
          mounted.container.querySelector<HTMLInputElement>('#exo-connect-server'),
          mounted.server.baseUrl,
        )
        setValue(
          mounted.container.querySelector<HTMLInputElement>('#exo-connect-token'),
          'sf_v1_wrong',
        )
      })
      await act(async () => {
        click(button(mounted.container, 'Connect'))
      })

      await vi.waitFor(() =>
        expect(mounted.container.textContent).toContain('The server rejected this token'),
      )
      expect(mounted.runtime.getSnapshot().phase).not.toBe('ready')
      expect(mounted.container.innerHTML).not.toContain('sf_v1_wrong')
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('shows the workspace section with connection details but no token', async () => {
    const mounted = await mount()
    try {
      await mounted.runtime.start()
      await mounted.runtime.connectRemote(
        { server: mounted.server.baseUrl, token: FAKE_TOKEN },
        { remember: true },
      )
      await act(async () => {
        mounted.runtime.openDocument('/exo.json')
      })

      await vi.waitFor(() =>
        expect(mounted.container.querySelector('#exo-settings-workspace')).not.toBeNull(),
      )
      const text = mounted.container.textContent ?? ''
      expect(text).toContain('Stratofold: demo')
      expect(text).toContain(mounted.server.baseUrl)
      expect(text).toContain('remembered in this browser')
      expect(text).not.toContain(FAKE_TOKEN)
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('names a rejected connection and disconnects from the banner', async () => {
    const mounted = await mount()
    try {
      await mounted.runtime.start()
      await mounted.runtime.connectRemote({
        server: mounted.server.baseUrl,
        token: FAKE_TOKEN,
      })

      mounted.server.failNext(401)
      await act(async () => {
        await mounted.runtime
          .getSession()
          ?.stat('/a.txt')
          .catch(() => undefined)
      })

      await vi.waitFor(() =>
        expect(mounted.container.querySelector('.exo-reconnect-banner')?.textContent).toContain(
          'The connection to demo was rejected.',
        ),
      )
      const requestsAfterRejection = mounted.server.requests.length

      await act(async () => {
        click(mounted.container.querySelector('.exo-reconnect-banner button:last-of-type'))
      })

      await vi.waitFor(() =>
        expect(mounted.runtime.getSnapshot()).toMatchObject({
          phase: 'no-workspace',
        }),
      )
      expect(mounted.container.querySelector('.exo-reconnect-banner')).toBeNull()
      expect(mounted.server.requests.length).toBe(requestsAfterRejection)
      expect(useWorkbenchStore.getState().tabs).toEqual([])
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })
})

describe('remote workspace dirty guard', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('asks about unsaved changes before connecting elsewhere', async () => {
    const mounted = await mount()
    try {
      await mounted.runtime.start()
      // Open a local workspace through the folder path with a dirty document.
      await mounted.runtime.openFolder()
      await mounted.runtime.documents.open('/a.txt')
      mounted.runtime.documents.updateText('/a.txt', 'unsaved')
      expect(mounted.runtime.documents.dirtyPaths()).toEqual(['/a.txt'])

      await act(async () => {
        requestRemoteConnect()
      })

      await vi.waitFor(() =>
        expect(mounted.container.querySelector('.exo-dialog')?.textContent).toContain(
          'Unsaved changes',
        ),
      )
      expect(mounted.container.querySelector('#exo-connect-server')).toBeNull()
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })
})
