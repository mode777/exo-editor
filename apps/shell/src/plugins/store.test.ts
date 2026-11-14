import { describe, expect, it, vi } from 'vitest'
import { Session } from '../workspace/session'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { WorkspaceError, type WorkspaceHandle } from '../workspace/contract'
import { EXO_CONFIG_MAX_BYTES, EXO_CONFIG_PATH } from './config'
import { PluginConfigStore } from './store'

const decoder = new TextDecoder()

function configJson(manifests: string[]): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      plugins: manifests.map((manifest) => ({ manifest })),
    },
    null,
    2,
  )}\n`
}

function canonicalJson(manifests: string[]): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      plugins: manifests.map((manifest) => ({ manifest, enabled: true })),
    },
    null,
    2,
  )}\n`
}

async function setup(files: Record<string, string | Uint8Array> = {}) {
  const eventTarget = new EventTarget()
  const provider = new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: files,
    watchable: true,
  })
  const handle = await provider.open()
  const session = new Session(handle, { eventTarget, now: () => 1 })
  const store = new PluginConfigStore({ eventTarget, isVisible: () => true })
  await store.attach(session)
  return { provider, handle, session, store, eventTarget }
}

async function readConfig(handle: WorkspaceHandle): Promise<string> {
  return decoder.decode(await handle.read(EXO_CONFIG_PATH))
}

describe('plugin configuration store', () => {
  it('loads a valid declaration and treats a missing file as absent', async () => {
    const missing = await setup()
    expect(missing.store.getSnapshot()).toMatchObject({
      status: 'absent',
      path: EXO_CONFIG_PATH,
      version: null,
      text: null,
      entries: [],
      issues: [],
    })
    missing.store.detach()
    missing.session.dispose()

    const valid = await setup({
      [EXO_CONFIG_PATH]: configJson(['https://example.com/m.json']),
    })
    expect(valid.store.getSnapshot()).toMatchObject({
      status: 'valid',
      entries: [{ index: 0, manifest: 'https://example.com/m.json', enabled: true }],
      issues: [],
      busy: false,
    })
    valid.store.detach()
    valid.session.dispose()
  })

  it('publishes invalid JSON and every validation issue', async () => {
    const { store, session } = await setup({
      [EXO_CONFIG_PATH]:
        '{"schemaVersion":1,"plugins":[{"manifest":"https://ok.example/m.json"},{"manifest":"http://bad.example/m.json","extra":true}]}',
    })
    const snapshot = store.getSnapshot()
    expect(snapshot.status).toBe('invalid')
    expect(snapshot.entries).toEqual([])
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-config',
          field: '/plugins/1/manifest',
          entryIndex: 1,
        }),
        expect.objectContaining({
          code: 'invalid-config',
          field: '/plugins/1/extra',
          entryIndex: 1,
        }),
      ]),
    )
    store.detach()
    session.dispose()
  })

  it('refreshes an external edit on focus and skips an unchanged version', async () => {
    const { provider, session, store, eventTarget } = await setup({
      [EXO_CONFIG_PATH]: configJson(['https://a.example/m.json']),
    })
    const read = vi.spyOn(session, 'read')

    await store.refresh()
    expect(read).not.toHaveBeenCalled()

    provider.seed(EXO_CONFIG_PATH, configJson(['https://b.example/m.json']))
    eventTarget.dispatchEvent(new Event('focus'))
    await vi.waitFor(() =>
      expect(store.getSnapshot().entries).toEqual([
        { index: 0, manifest: 'https://b.example/m.json', enabled: true },
      ]),
    )
    expect(store.getSnapshot().status).toBe('valid')

    read.mockRestore()
    store.detach()
    session.dispose()
  })

  it('reports an oversized file without reading it', async () => {
    const oversized = `{"schemaVersion":1,"plugins":[],"padding":"${'x'.repeat(
      EXO_CONFIG_MAX_BYTES,
    )}"}`
    const { session, store } = await setup({ [EXO_CONFIG_PATH]: oversized })
    expect(store.getSnapshot()).toMatchObject({
      status: 'invalid',
      entries: [],
      text: null,
      issues: [{ code: 'too-large', path: EXO_CONFIG_PATH }],
    })
    store.detach()
    session.dispose()
  })

  it('reports a read failure as not-readable', async () => {
    const { session, store } = await setup({
      [EXO_CONFIG_PATH]: configJson(['https://a.example/m.json']),
    })
    vi.spyOn(session, 'read').mockRejectedValue(
      new WorkspaceError('permission-denied', 'blocked', { path: EXO_CONFIG_PATH }),
    )
    await store.refresh(true)
    expect(store.getSnapshot()).toMatchObject({
      status: 'invalid',
      entries: [],
      issues: [{ code: 'not-readable', path: EXO_CONFIG_PATH }],
    })
    store.detach()
    session.dispose()
  })

  it('adds, toggles and removes entries canonically', async () => {
    const { handle, session, store } = await setup()
    expect(await store.addEntry('https://example.com/m.json')).toEqual({ ok: true })
    expect(store.getSnapshot()).toMatchObject({
      status: 'valid',
      entries: [{ index: 0, manifest: 'https://example.com/m.json', enabled: true }],
    })
    expect(await readConfig(handle)).toBe(canonicalJson(['https://example.com/m.json']))

    expect(await store.setEnabled(0, false)).toEqual({ ok: true })
    expect(store.getSnapshot().entries[0]?.enabled).toBe(false)
    expect(await readConfig(handle)).toContain('"enabled": false')

    expect(await store.addEntry('https://second.example/m.json')).toEqual({ ok: true })
    expect(await store.removeEntry(0)).toEqual({ ok: true })
    expect(store.getSnapshot().entries).toEqual([
      { index: 0, manifest: 'https://second.example/m.json', enabled: true },
    ])
    expect(await readConfig(handle)).toBe(canonicalJson(['https://second.example/m.json']))

    store.detach()
    session.dispose()
  })

  it('rejects an invalid URL and a duplicate without writing', async () => {
    const { handle, session, store } = await setup({
      [EXO_CONFIG_PATH]: configJson(['https://example.com/m.json']),
    })
    const before = await readConfig(handle)

    const invalid = await store.addEntry('relative/path.json')
    expect(invalid.ok).toBe(false)
    expect(invalid.ok ? [] : invalid.issues[0]).toMatchObject({
      code: 'invalid-config',
      field: '/plugins/1/manifest',
      entryIndex: 1,
    })

    const duplicate = await store.addEntry('https://example.com/m.json')
    expect(duplicate.ok).toBe(false)
    expect(duplicate.ok ? [] : duplicate.issues).toEqual([
      expect.objectContaining({
        code: 'duplicate-manifest',
        entryIndex: 0,
      }),
      expect.objectContaining({
        code: 'duplicate-manifest',
        entryIndex: 1,
      }),
    ])

    expect(await readConfig(handle)).toBe(before)
    store.detach()
    session.dispose()
  })

  it('saves valid raw text canonically and rejects invalid text', async () => {
    const { handle, session, store } = await setup()
    const before = await readConfig(handle).catch(() => null)
    expect(before).toBeNull()

    const invalid = await store.saveRaw('{"schemaVersion":1,"plugins":[,]}')
    expect(invalid.ok).toBe(false)
    expect(await readConfig(handle).catch(() => null)).toBeNull()

    const canonical = await store.saveRaw(
      '{"schemaVersion":1,"plugins":[{"manifest":"https://example.com/m.json"}]}',
    )
    expect(canonical).toEqual({ ok: true })
    expect(await readConfig(handle)).toBe(canonicalJson(['https://example.com/m.json']))
    expect(store.getSnapshot().entries).toEqual([
      { index: 0, manifest: 'https://example.com/m.json', enabled: true },
    ])

    store.detach()
    session.dispose()
  })

  it('fails a stale write with conflict and preserves the external content', async () => {
    const { provider, handle, session, store } = await setup({
      [EXO_CONFIG_PATH]: configJson(['https://a.example/m.json']),
    })
    const external = configJson(['https://external.example/m.json'])
    provider.seed(EXO_CONFIG_PATH, external)

    const result = await store.addEntry('https://b.example/m.json')
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues).toEqual([{ code: 'conflict', path: EXO_CONFIG_PATH }])
    expect(await readConfig(handle)).toBe(external)

    await store.refresh(true)
    expect(store.getSnapshot().entries).toEqual([
      { index: 0, manifest: 'https://external.example/m.json', enabled: true },
    ])

    store.detach()
    session.dispose()
  })

  it('drops a late load from the previous workspace', async () => {
    const eventTarget = new EventTarget()
    const firstProvider = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { [EXO_CONFIG_PATH]: configJson(['https://first.example/m.json']) },
    })
    const firstHandle = await firstProvider.open()
    let releaseRead: (() => void) | null = null
    const originalRead = firstHandle.read.bind(firstHandle)
    firstHandle.read = async (path, options) => {
      if (path === EXO_CONFIG_PATH) {
        await new Promise<void>((resolve) => {
          releaseRead = resolve
        })
      }
      return originalRead(path, options)
    }
    const firstSession = new Session(firstHandle, { eventTarget, now: () => 1 })

    const secondProvider = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { [EXO_CONFIG_PATH]: configJson(['https://second.example/m.json']) },
    })
    const secondHandle = await secondProvider.open()
    const secondSession = new Session(secondHandle, { eventTarget, now: () => 1 })

    const store = new PluginConfigStore({ eventTarget, isVisible: () => true })
    const firstAttach = store.attach(firstSession)
    await vi.waitFor(() => expect(releaseRead).not.toBeNull())
    const secondAttach = store.attach(secondSession)
    ;(releaseRead as unknown as () => void)()
    await Promise.all([firstAttach, secondAttach])

    expect(store.getSnapshot().entries).toEqual([
      { index: 0, manifest: 'https://second.example/m.json', enabled: true },
    ])
    store.detach()
    firstSession.dispose()
    secondSession.dispose()
  })

  it('does not mutate the new workspace from a write started in the old one', async () => {
    const eventTarget = new EventTarget()
    const firstProvider = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { [EXO_CONFIG_PATH]: configJson(['https://first.example/m.json']) },
    })
    const firstHandle = await firstProvider.open()
    let releaseWrite: (() => void) | null = null
    const originalWrite = firstHandle.write.bind(firstHandle)
    firstHandle.write = async (path, data, options) => {
      if (path === EXO_CONFIG_PATH) {
        await new Promise<void>((resolve) => {
          releaseWrite = resolve
        })
      }
      return originalWrite(path, data, options)
    }
    const firstSession = new Session(firstHandle, { eventTarget, now: () => 1 })

    const secondProvider = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { [EXO_CONFIG_PATH]: configJson(['https://second.example/m.json']) },
    })
    const secondHandle = await secondProvider.open()
    const secondSession = new Session(secondHandle, { eventTarget, now: () => 1 })

    const store = new PluginConfigStore({ eventTarget, isVisible: () => true })
    await store.attach(firstSession)
    const write = store.addEntry('https://new.example/m.json')
    await vi.waitFor(() => expect(releaseWrite).not.toBeNull())
    await store.attach(secondSession)
    ;(releaseWrite as unknown as () => void)()
    await write

    expect(store.getSnapshot().entries).toEqual([
      { index: 0, manifest: 'https://second.example/m.json', enabled: true },
    ])
    expect(await readConfig(secondHandle)).toBe(configJson(['https://second.example/m.json']))
    store.detach()
    firstSession.dispose()
    secondSession.dispose()
  })

  it('stops refreshing after detach', async () => {
    const { eventTarget, session, store } = await setup({
      [EXO_CONFIG_PATH]: configJson(['https://a.example/m.json']),
    })
    store.detach()
    const stat = vi.spyOn(session, 'stat')
    eventTarget.dispatchEvent(new Event('focus'))
    await Promise.resolve()
    expect(stat).not.toHaveBeenCalled()
    expect(store.getSnapshot().status).toBe('idle')
    session.dispose()
  })
})
