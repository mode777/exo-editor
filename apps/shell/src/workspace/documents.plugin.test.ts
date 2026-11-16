import { describe, expect, it, vi } from 'vitest'
import { DocumentStore, type DocumentEditorHost, type PluginCallbacks } from './documents'
import { MemoryWorkspaceProvider } from './providers/memory'
import { Session } from './session'
import type { FileStat, WorkspaceChange } from './contract'
import type { EditorCandidate } from '../plugins/registry'
import type { HandlerSaveCompletion, HandlerSaveRequest } from '../plugins/handler'

function candidate(overrides: Partial<EditorCandidate> = {}): EditorCandidate {
  return {
    identity: 'https://plugins.example.com::com.example.code',
    pluginOrder: 0,
    pluginName: 'Code Plugin',
    pluginId: 'com.example.code',
    pluginVersion: '1.0.0',
    origin: 'https://plugins.example.com',
    permissions: ['workspace:read', 'workspace:write'],
    glob: '**/*.txt',
    entry: 'editor.html',
    entryUrl: 'https://plugins.example.com/editor.html',
    label: 'Code',
    priority: 0,
    registrationOrder: 0,
    ...overrides,
  }
}

class FakeEditors implements DocumentEditorHost {
  list: EditorCandidate[] = [candidate()]
  openResult: { ok: true } | { ok: false; reason: 'cap' | 'failed'; message?: string } = {
    ok: true,
  }
  saveRequest: HandlerSaveRequest = {
    ok: true,
    requestId: 'save-1',
    content: { text: 'edited' },
    baseVersion: 'v1',
  }
  seq = 0
  bumpOnSave = false
  deferSave: {
    promise: Promise<HandlerSaveRequest>
    resolve: (value: HandlerSaveRequest) => void
  } | null = null
  callbacks: PluginCallbacks | null = null
  opened: Array<{ path: string; candidate: EditorCandidate }> = []
  closed: string[] = []
  completed: Array<{ path: string; result: HandlerSaveCompletion }> = []
  changes: WorkspaceChange[] = []
  renamed: Array<[string, string]> = []
  order: string[] = []

  candidates(): EditorCandidate[] {
    return this.list
  }

  open(
    input: { path: string; file: FileStat; candidate: EditorCandidate },
    callbacks: PluginCallbacks,
  ) {
    this.opened.push({ path: input.path, candidate: input.candidate })
    this.callbacks = callbacks
    return this.openResult
  }

  close(path: string): void {
    this.closed.push(path)
  }

  async save(): Promise<HandlerSaveRequest> {
    if (this.bumpOnSave) this.seq += 1
    if (this.deferSave) return this.deferSave.promise
    return this.saveRequest
  }

  completeSave(path: string, result: HandlerSaveCompletion): void {
    this.order.push('save-result')
    this.completed.push({ path, result })
  }

  notifyChange(change: WorkspaceChange): void {
    this.changes.push(change)
  }

  rename(previousPath: string, nextPath: string): void {
    this.renamed.push([previousPath, nextPath])
  }

  dirtySequence(): number {
    return this.seq
  }
}

async function setup(files: Record<string, string> = { '/a.txt': 'one' }) {
  const provider = new MemoryWorkspaceProvider({ now: () => 1, initialFiles: files })
  const handle = await provider.open()
  const session = new Session(handle, {
    eventTarget: new EventTarget(),
    isVisible: () => true,
  })
  const editors = new FakeEditors()
  const baseStat = await handle.stat('/a.txt')
  editors.saveRequest = {
    ok: true,
    requestId: 'save-1',
    content: { text: 'edited' },
    baseVersion: baseStat.version,
  }
  const dirty: Array<[string, boolean]> = []
  const saved: WorkspaceChange[] = []
  const store = new DocumentStore({
    getSession: () => session,
    onDirtyChange: (path, value) => dirty.push([path, value]),
    onSaved: (change) => {
      editors.order.push('file-changed')
      saved.push(change)
    },
    editors,
  })
  return { provider, handle, session, store, editors, dirty, saved }
}

async function activate(editors: FakeEditors) {
  editors.callbacks?.onActive()
}

describe('plugin-backed documents', () => {
  it('mounts a handler instead of reading the file', async () => {
    const { store, editors, handle } = await setup()
    const read = vi.spyOn(handle, 'read')
    const document = await store.open('/a.txt')
    expect(document).toMatchObject({
      status: 'plugin',
      surface: 'plugin',
      pluginPhase: 'mounting',
      editor: { pluginName: 'Code Plugin', canWrite: true, rendering: 'hidden' },
      dirty: false,
    })
    expect(editors.opened).toHaveLength(1)
    expect(read).not.toHaveBeenCalled()
  })

  it('carries a frame rendering contribution to the document state', async () => {
    const { store, editors } = await setup()
    editors.list = [candidate({ rendering: 'frame' })]
    const document = await store.open('/a.txt')
    expect(document?.editor).toMatchObject({ rendering: 'frame' })
  })

  it('keeps the text surface when no editor matches', async () => {
    const { store, editors } = await setup()
    editors.list = []
    const document = await store.open('/a.txt')
    expect(document).toMatchObject({ status: 'ready', surface: 'text', text: 'one' })
  })

  it('falls back to text with a notice at the frame cap', async () => {
    const { store, editors } = await setup()
    editors.openResult = { ok: false, reason: 'cap' }
    const document = await store.open('/a.txt')
    expect(document).toMatchObject({
      status: 'ready',
      surface: 'text',
      pluginNotice: expect.stringContaining('20'),
    })
  })

  it('becomes active and mirrors dirty reports to the tab', async () => {
    const { store, editors, dirty } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    expect(store.get('/a.txt')).toMatchObject({ pluginPhase: 'active', dirty: true })
    expect(dirty.at(-1)).toEqual(['/a.txt', true])
    expect(store.hasDirty()).toBe(true)
    expect(store.dirtyPathsFor(candidate().identity)).toEqual(['/a.txt'])
  })

  it('saves through the handler and completes the round trip', async () => {
    const { store, editors, session } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    expect(await store.save('/a.txt')).toBe(true)
    expect(editors.completed.at(-1)).toEqual({
      path: '/a.txt',
      result: { ok: true, version: expect.any(String) },
    })
    const written = new TextDecoder().decode(await session.read('/a.txt'))
    expect(written).toBe('edited')
    expect(store.get('/a.txt')).toMatchObject({ dirty: false, pluginError: undefined })
  })

  it('reports a successful save before the file-change notification', async () => {
    const { store, editors, saved } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    expect(await store.save('/a.txt')).toBe(true)
    expect(editors.order).toEqual(['save-result', 'file-changed'])
    expect(saved).toEqual([{ kind: 'changed', path: '/a.txt', stat: expect.any(Object) }])
  })

  it('stays dirty when the plugin reports again during the write', async () => {
    const { store, editors } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    editors.bumpOnSave = true
    expect(await store.save('/a.txt')).toBe(true)
    expect(store.get('/a.txt')).toMatchObject({ dirty: true })
  })

  it('keeps the tab dirty and reports conflict', async () => {
    const { store, editors, session } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    const stat = await session.stat('/a.txt')
    await session.write('/a.txt', new TextEncoder().encode('newer'), {
      ifVersion: stat.version,
    })
    expect(await store.save('/a.txt')).toBe(false)
    expect(store.get('/a.txt')).toMatchObject({
      dirty: true,
      external: 'changed',
      pluginError: { code: 'conflict' },
    })
    expect(editors.completed.at(-1)).toMatchObject({
      result: { ok: false, code: 'conflict' },
    })
    expect(new TextDecoder().decode(await session.read('/a.txt'))).toBe('newer')
  })

  it('keeps the tab dirty when the save times out', async () => {
    const { store, editors } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    editors.saveRequest = { ok: false, code: 'timeout' }
    expect(await store.save('/a.txt')).toBe(false)
    expect(store.get('/a.txt')).toMatchObject({
      dirty: true,
      pluginError: { code: 'timeout' },
    })
  })

  it('does not offer a save for a read-only editor', async () => {
    const { store, editors } = await setup()
    editors.list = [candidate({ permissions: ['workspace:read'] })]
    await store.open('/a.txt')
    await activate(editors)
    expect(store.get('/a.txt')?.readOnly).toBe(true)
    expect(await store.save('/a.txt')).toBe(false)
    expect(editors.opened[0].candidate.permissions).toEqual(['workspace:read'])
  })

  it('forwards external changes and follows a rename', async () => {
    const { store, editors, handle } = await setup({ '/a.txt': 'one' })
    await store.open('/a.txt')
    await activate(editors)
    const stat = await handle.stat('/a.txt')
    store.applyExternal({ kind: 'changed', path: '/a.txt', stat: { ...stat, version: 'v2' } })
    expect(editors.changes.at(-1)).toMatchObject({ kind: 'changed', path: '/a.txt' })
    expect(store.get('/a.txt')?.external).toBe('changed')

    store.applyExternal({
      kind: 'renamed',
      previousPath: '/a.txt',
      path: '/b.txt',
      stat: { ...stat, path: '/b.txt', version: 'v2' },
    })
    expect(editors.renamed).toEqual([['/a.txt', '/b.txt']])
    expect(store.get('/b.txt')).toMatchObject({ surface: 'plugin', external: 'changed' })
    expect(store.get('/a.txt')).toBeUndefined()
    expect(editors.changes.at(-1)).toMatchObject({ kind: 'renamed', path: '/b.txt' })
  })

  it('marks a deleted file without recreating it', async () => {
    const { store, editors } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    store.applyExternal({ kind: 'deleted', path: '/a.txt' })
    expect(store.get('/a.txt')?.external).toBe('deleted')
    expect(editors.changes.at(-1)).toMatchObject({ kind: 'deleted' })
    expect(await store.save('/a.txt')).toBe(false)
  })

  it('re-mounts with an alternative editor for one path only', async () => {
    const { store, editors } = await setup({ '/a.txt': 'one', '/b.txt': 'two' })
    await store.open('/a.txt')
    await store.open('/b.txt')
    const alternative = candidate({
      identity: 'https://other.example.com::com.example.other',
      pluginName: 'Other Plugin',
      label: 'Other',
      priority: -1,
    })
    editors.list = [candidate(), alternative]
    await store.chooseEditor('/a.txt', alternative)
    expect(editors.closed).toContain('/a.txt')
    expect(editors.opened.at(-1)).toMatchObject({
      path: '/a.txt',
      candidate: { identity: alternative.identity },
    })
    expect(editors.opened.filter((entry) => entry.path === '/b.txt')).toHaveLength(1)
  })

  it('opens in text even when an editor matches', async () => {
    const { store, editors, dirty } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    await store.openInText('/a.txt')
    expect(store.get('/a.txt')).toMatchObject({ status: 'ready', surface: 'text' })
    expect(dirty.at(-1)).toEqual(['/a.txt', false])
  })

  it('disposes handlers on close and workspace reset', async () => {
    const { store, editors } = await setup({ '/a.txt': 'one', '/b.txt': 'two' })
    await store.open('/a.txt')
    store.close('/a.txt')
    expect(editors.closed).toContain('/a.txt')
    await store.open('/b.txt')
    store.clear()
    expect(editors.closed).toContain('/b.txt')
    expect(store.paths()).toEqual([])
  })

  it('cancels a pending save on workspace reset and writes nothing', async () => {
    const { store, editors, session, handle } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    const write = vi.spyOn(handle, 'write')
    let resolveSave: (value: HandlerSaveRequest) => void = () => undefined
    editors.deferSave = {
      promise: new Promise((resolve) => {
        resolveSave = resolve
      }),
      resolve: resolveSave,
    }
    const saving = store.save('/a.txt')
    store.clear()
    resolveSave(editors.saveRequest)
    await expect(saving).resolves.toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(new TextDecoder().decode(await session.read('/a.txt'))).toBe('one')
  })

  it('marks a failed handler without clearing a reported dirty state', async () => {
    const { store, editors } = await setup()
    await store.open('/a.txt')
    await activate(editors)
    editors.callbacks?.onDirty(true)
    editors.callbacks?.onFailure({
      code: 'protocol-violation',
      phase: 'editor',
      message: 'bad frame',
    })
    expect(store.get('/a.txt')).toMatchObject({
      pluginPhase: 'failed',
      dirty: true,
      pluginError: { code: 'protocol-violation' },
    })
    expect(await store.save('/a.txt')).toBe(false)
  })
})
