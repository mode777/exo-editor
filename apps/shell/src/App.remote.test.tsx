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
import {
  FAKE_TOKEN,
  FAKE_VDIR,
  FakeStratofoldServer,
} from './workspace/providers/stratofold/fake-server'
import { stratofoldWorkspaceId } from './workspace/providers/stratofold/provider'
import { configurePresetStore, clearWorkspaceTabs } from './workbench/tabs'
import { requestRemoteConnect } from './workspace/connect-bus'

interface Mounted {
  runtime: WorkspaceRuntime
  server: FakeStratofoldServer
  connectionStore: MemoryConnectionStore
  container: HTMLElement
  root: Root
}

async function mount(server = new FakeStratofoldServer({ initialFiles: { 'a.txt': 'one' } })) {
  const connectionStore = new MemoryConnectionStore()
  const runtime = new WorkspaceRuntime({
    providerFactory: () => new MemoryWorkspaceProvider({ initialFiles: { '/a.txt': 'one' } }),
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    activeStore: new MemoryActiveWorkspaceStore(),
    connectionStore,
    connectSeams: { fetch: server.fetch, createXhr: server.createXhr },
    eventTarget: new EventTarget(),
    now: () => 1,
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  return { runtime, server, connectionStore, container, root }
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

async function connectThroughDialog(mounted: Mounted, token = FAKE_TOKEN) {
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
  })
  await act(async () => {
    click(button(mounted.container, 'Connect'))
  })
  await vi.waitFor(() => expect(mounted.container.querySelector('#exo-connect-server')).toBeNull())
}

function remoteId(server: FakeStratofoldServer): string {
  return stratofoldWorkspaceId({
    server: server.baseUrl,
    vdir: server.vdir,
    name: server.vdirName,
    role: 'editor',
  })
}

function connectionStringFor(parts: { server: string; vdir?: string; token?: string }): string {
  return `sfconn_v1_${Buffer.from(
    JSON.stringify({
      v: 1,
      url: parts.server,
      vdir: parts.vdir ?? FAKE_VDIR,
      token: parts.token ?? FAKE_TOKEN,
    }),
    'utf8',
  ).toString('base64url')}`
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
      await connectThroughDialog(mounted)

      await vi.waitFor(() => expect(mounted.container.textContent).toContain('a.txt'))
      expect(mounted.runtime.getSnapshot()).toMatchObject({
        phase: 'ready',
        remote: { name: 'demo', stored: true, rejected: false },
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
      await mounted.runtime.connectRemote({ server: mounted.server.baseUrl, token: FAKE_TOKEN })
      await act(async () => {
        mounted.runtime.openDocument('/exo.json')
      })

      await vi.waitFor(() =>
        expect(mounted.container.querySelector('#exo-settings-workspace')).not.toBeNull(),
      )
      const text = mounted.container.textContent ?? ''
      expect(text).toContain('Stratofold: demo')
      expect(text).toContain(mounted.server.baseUrl)
      expect(text).toContain('stored in this browser')
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

describe('remote workspace connection strings', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  async function openDialog(mounted: Mounted) {
    await vi.waitFor(() => expect(button(mounted.container, 'Connect Remote…')).not.toBeNull())
    click(button(mounted.container, 'Connect Remote…'))
    await vi.waitFor(() =>
      expect(mounted.container.querySelector('#exo-connect-connection-string')).not.toBeNull(),
    )
  }

  it('fills the form from a pasted connection string, clears it, and connects', async () => {
    const mounted = await mount()
    try {
      await openDialog(mounted)
      const value = connectionStringFor({ server: mounted.server.baseUrl })
      const input = mounted.container.querySelector<HTMLInputElement>(
        '#exo-connect-connection-string',
      )
      await act(async () => setValue(input, value))

      expect(input?.value).toBe('')
      expect(mounted.container.querySelector<HTMLInputElement>('#exo-connect-server')?.value).toBe(
        mounted.server.baseUrl,
      )
      expect(mounted.container.querySelector<HTMLInputElement>('#exo-connect-token')?.value).toBe(
        FAKE_TOKEN,
      )

      await act(async () => {
        click(button(mounted.container, 'Connect'))
      })
      await vi.waitFor(() =>
        expect(mounted.container.querySelector('#exo-connect-server')).toBeNull(),
      )
      await vi.waitFor(() => expect(mounted.container.textContent).toContain('a.txt'))

      expect(mounted.runtime.getSnapshot()).toMatchObject({
        phase: 'ready',
        remote: { name: 'demo', role: 'editor', server: mounted.server.baseUrl },
      })
      expect(mounted.container.innerHTML).not.toContain('sfconn_v1_')
      expect(mounted.container.innerHTML).not.toContain(FAKE_TOKEN)
      expect(mounted.server.requests.every((request) => !request.url.includes('sfconn_v1_'))).toBe(
        true,
      )
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('rejects a malformed connection string locally without a request', async () => {
    const mounted = await mount()
    try {
      await openDialog(mounted)
      const before = mounted.server.requests.length
      const input = mounted.container.querySelector<HTMLInputElement>(
        '#exo-connect-connection-string',
      )
      await act(async () => setValue(input, 'sfconn_v1_%%%'))
      await act(async () => {
        click(button(mounted.container, 'Connect'))
      })

      await vi.waitFor(() =>
        expect(mounted.container.textContent).toContain('connection string is not valid'),
      )
      expect(mounted.server.requests.length).toBe(before)
      expect(mounted.runtime.getSnapshot().phase).not.toBe('ready')
      expect(input?.value).toBe('sfconn_v1_%%%')
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('stores only the decomposed fields of a connection string', async () => {
    const mounted = await mount()
    try {
      await openDialog(mounted)
      const value = connectionStringFor({ server: mounted.server.baseUrl })
      await act(async () =>
        setValue(
          mounted.container.querySelector<HTMLInputElement>('#exo-connect-connection-string'),
          value,
        ),
      )
      await act(async () => {
        click(button(mounted.container, 'Connect'))
      })
      await vi.waitFor(() =>
        expect(mounted.container.querySelector('#exo-connect-server')).toBeNull(),
      )
      await vi.waitFor(() => expect(mounted.container.textContent).toContain('a.txt'))

      const record = await mounted.connectionStore.get(remoteId(mounted.server))
      expect(record?.connection).toEqual({
        server: mounted.server.baseUrl,
        vdir: FAKE_VDIR,
        name: 'demo',
        role: 'editor',
        token: FAKE_TOKEN,
      })
      const serialized = JSON.stringify(record)
      expect(serialized).not.toContain('sfconn_v1_')
      expect(serialized).not.toContain(value)
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('uses a corrected server origin with the string directory and token', async () => {
    const mounted = await mount()
    try {
      await openDialog(mounted)
      const value = connectionStringFor({ server: 'https://stale.test' })
      await act(async () =>
        setValue(
          mounted.container.querySelector<HTMLInputElement>('#exo-connect-connection-string'),
          value,
        ),
      )
      expect(mounted.container.querySelector<HTMLInputElement>('#exo-connect-server')?.value).toBe(
        'https://stale.test',
      )

      await act(async () =>
        setValue(
          mounted.container.querySelector<HTMLInputElement>('#exo-connect-server'),
          mounted.server.baseUrl,
        ),
      )
      await act(async () => {
        click(button(mounted.container, 'Connect'))
      })

      await vi.waitFor(() =>
        expect(mounted.container.querySelector('#exo-connect-server')).toBeNull(),
      )
      expect(mounted.runtime.getSnapshot().remote).toMatchObject({
        server: mounted.server.baseUrl,
        name: 'demo',
        role: 'editor',
      })
      expect(mounted.server.requests[0].url.startsWith(mounted.server.baseUrl)).toBe(true)
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })
})

describe('remote workspace recents', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  async function openRecents(mounted: Mounted) {
    await vi.waitFor(() => expect(button(mounted.container, 'Connect Remote…')).not.toBeNull())
    click(button(mounted.container, 'Connect Remote…'))
    await vi.waitFor(() =>
      expect(mounted.container.querySelector('#exo-recents-title')?.textContent).toContain(
        'Recent workspaces',
      ),
    )
  }

  it('lists a stored workspace, reopens it and never renders the token', async () => {
    const mounted = await mount()
    try {
      await mounted.runtime.start()
      await mounted.runtime.connectRemote({
        server: mounted.server.baseUrl,
        token: FAKE_TOKEN,
      })
      await mounted.runtime.disconnect()

      await openRecents(mounted)
      expect(mounted.container.querySelector('#exo-connect-remember')).toBeNull()
      expect(mounted.container.textContent).toContain('Connections and their tokens are stored')
      expect(mounted.container.textContent).toContain(mounted.server.vdir)
      expect(mounted.container.innerHTML).not.toContain(FAKE_TOKEN)

      await act(async () => {
        click(mounted.container.querySelector('[aria-label="Open demo"]'))
      })

      await vi.waitFor(() =>
        expect(mounted.container.querySelector('#exo-connect-server')).toBeNull(),
      )
      expect(mounted.runtime.getSnapshot()).toMatchObject({
        phase: 'ready',
        remote: { name: 'demo', stored: true },
      })
      expect(mounted.container.innerHTML).not.toContain(FAKE_TOKEN)
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('removes one entry and deletes its token', async () => {
    const mounted = await mount()
    try {
      await mounted.runtime.start()
      await mounted.runtime.connectRemote({
        server: mounted.server.baseUrl,
        token: FAKE_TOKEN,
      })
      await mounted.runtime.disconnect()

      await openRecents(mounted)
      await act(async () => {
        click(mounted.container.querySelector('[aria-label="Remove demo"]'))
      })

      await vi.waitFor(async () => {
        expect(await mounted.connectionStore.get(remoteId(mounted.server))).toBeNull()
      })
      await vi.waitFor(() =>
        expect(mounted.container.querySelector('#exo-recents-title')).toBeNull(),
      )
      expect(mounted.container.innerHTML).not.toContain(FAKE_TOKEN)
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('reports a failed reopen and keeps the entry', async () => {
    const mounted = await mount()
    try {
      await mounted.runtime.start()
      await mounted.runtime.connectRemote({
        server: mounted.server.baseUrl,
        token: FAKE_TOKEN,
      })
      await mounted.runtime.disconnect()

      mounted.server.failNext(401)
      await openRecents(mounted)
      await act(async () => {
        click(mounted.container.querySelector('[aria-label="Open demo"]'))
      })

      await vi.waitFor(() =>
        expect(mounted.container.textContent).toContain('The server rejected this token'),
      )
      expect(mounted.runtime.getSnapshot().phase).toBe('no-workspace')
      expect(await mounted.connectionStore.get(remoteId(mounted.server))).not.toBeNull()
      expect(mounted.container.querySelector('#exo-connect-server')).not.toBeNull()
    } finally {
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
      await mounted.runtime.dispose()
    }
  })

  it('removes the active workspace from settings', async () => {
    const mounted = await mount()
    try {
      await mounted.runtime.start()
      await mounted.runtime.connectRemote({
        server: mounted.server.baseUrl,
        token: FAKE_TOKEN,
      })

      await act(async () => {
        useWorkbenchStore.getState().setQuickOpen(true, 'commands')
      })
      const settingsEntry = Array.from(
        mounted.container.querySelectorAll('[role="dialog"][aria-label="Command palette"] button'),
      ).find((element) => element.textContent?.includes('Open Settings'))
      await act(async () => {
        ;(settingsEntry as HTMLButtonElement | undefined)?.click()
      })

      await vi.waitFor(() =>
        expect(button(mounted.container, 'Remove from Recent Workspaces')).not.toBeNull(),
      )
      await act(async () => {
        click(button(mounted.container, 'Remove from Recent Workspaces'))
      })

      await vi.waitFor(() => expect(mounted.runtime.getSnapshot().phase).toBe('no-workspace'))
      expect(await mounted.connectionStore.get(remoteId(mounted.server))).toBeNull()
      expect(mounted.runtime.getSnapshot().remote).toBeUndefined()
      expect(mounted.container.textContent).toContain('No workspace is open.')
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
