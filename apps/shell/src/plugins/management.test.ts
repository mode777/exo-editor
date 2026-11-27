import { describe, expect, it, vi } from 'vitest'
import { PluginManagement } from './management'
import type { PluginConfigStore } from './store'
import type { PluginHost, PluginHostSnapshot } from './host'

function setup(options: { dirty?: string[]; saveSucceeds?: boolean } = {}) {
  const entries = [
    { index: 0, manifest: 'https://plugins.example.com/a/exo-manifest.json', enabled: true },
    { index: 1, manifest: 'https://plugins.example.com/b/exo-manifest.json', enabled: false },
  ]
  const config = {
    getSnapshot: () => ({ status: 'valid', entries }),
    addEntry: vi.fn(async () => ({ ok: true })),
    setEnabled: vi.fn(async () => ({ ok: true })),
    removeEntry: vi.fn(async () => ({ ok: true })),
  } as unknown as PluginConfigStore
  const host = {
    getSnapshot: (): PluginHostSnapshot => ({
      phase: 'ready',
      records: [
        {
          manifestUrl: entries[0]!.manifest,
          entryIndex: 0,
          enabled: true,
          phase: 'active',
          identity: 'https://plugins.example.com::com.example.a',
          consent: 'granted',
          registrations: [],
          panels: [],
          contentViews: [],
          commands: [],
          newFiles: [],
        },
        {
          manifestUrl: entries[1]!.manifest,
          entryIndex: 1,
          enabled: false,
          phase: 'disabled',
          identity: 'https://plugins.example.com::com.example.b',
          consent: 'none',
          registrations: [],
          panels: [],
          contentViews: [],
          commands: [],
          newFiles: [],
        },
      ],
      consentRequest: null,
      log: [],
      revision: 0,
    }),
    requestConsent: vi.fn(),
    revokeConsent: vi.fn(),
  } as unknown as PluginHost
  const documents = {
    dirtyPathsFor: vi.fn(() => options.dirty ?? []),
    save: vi.fn(async () => options.saveSucceeds ?? true),
  }
  const management = new PluginManagement({ config, host, documents })
  return { management, config, host, documents, entries }
}

describe('PluginManagement', () => {
  it('installs through the configuration store', async () => {
    const { management, config } = setup()
    await management.install('  https://plugins.example.com/new/exo-manifest.json  ')
    expect(config.addEntry).toHaveBeenCalledWith(
      'https://plugins.example.com/new/exo-manifest.json',
    )
  })

  it('maps enable and remove by normalized manifest URL', async () => {
    const { management, config } = setup()
    await management.setEnabled('https://plugins.example.com/a/exo-manifest.json', false)
    await management.remove('https://plugins.example.com/b/exo-manifest.json')
    expect(config.setEnabled).toHaveBeenCalledWith(0, false)
    expect(config.removeEntry).toHaveBeenCalledWith(1)
  })

  it('rejects an unknown manifest URL without writing', async () => {
    const { management, config } = setup()
    const result = await management.setEnabled('https://plugins.example.com/missing.json', true)
    expect(result.ok).toBe(false)
    expect(config.setEnabled).not.toHaveBeenCalled()
  })

  it('prompts before removing a plugin with dirty documents', async () => {
    const { management, config, documents, entries } = setup({ dirty: ['/draft.txt'] })
    let settled = false
    const pending = management.remove(entries[0]!.manifest).then((result) => {
      settled = true
      return result
    })
    expect(management.getSnapshot().pending).toMatchObject({
      paths: ['/draft.txt'],
      error: null,
    })
    expect(config.removeEntry).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    expect(await management.savePending()).toBe(true)
    expect(documents.save).toHaveBeenCalledWith('/draft.txt')
    expect(config.removeEntry).toHaveBeenCalledWith(0)
    expect(await pending).toEqual({ ok: true })
    expect(management.getSnapshot().pending).toBeNull()
  })

  it('keeps the prompt when a save fails', async () => {
    const { management, documents, entries } = setup({
      dirty: ['/draft.txt'],
      saveSucceeds: false,
    })
    void management.remove(entries[0]!.manifest)
    expect(await management.savePending()).toBe(false)
    expect(documents.save).toHaveBeenCalled()
    expect(management.getSnapshot().pending?.error).toContain('Could not save /draft.txt')
  })

  it('discards dirty documents and still removes', async () => {
    const { management, config, documents, entries } = setup({ dirty: ['/draft.txt'] })
    void management.remove(entries[0]!.manifest)
    await management.discardPending()
    expect(documents.save).not.toHaveBeenCalled()
    expect(config.removeEntry).toHaveBeenCalledWith(0)
    expect(management.getSnapshot().pending).toBeNull()
  })

  it('cancels without changing the plugin or documents', async () => {
    const { management, config, documents, entries } = setup({ dirty: ['/draft.txt'] })
    const pending = management.remove(entries[0]!.manifest)
    management.cancelPending()
    expect((await pending).ok).toBe(false)
    expect(config.removeEntry).not.toHaveBeenCalled()
    expect(documents.save).not.toHaveBeenCalled()
    expect(management.getSnapshot().pending).toBeNull()
  })

  it('guards revoke and delegates review', async () => {
    const { management, host, entries } = setup({ dirty: ['/draft.txt'] })
    const identity = 'https://plugins.example.com::com.example.a'
    management.reviewConsent(identity)
    expect(host.requestConsent).toHaveBeenCalledWith(identity)

    const revoke = management.revokeConsent(identity)
    await management.discardPending()
    expect(host.revokeConsent).toHaveBeenCalledWith(identity)
    expect((await revoke).ok).toBe(true)
    expect(entries[0]!.manifest).toContain('a/exo-manifest.json')
  })

  it('resets a pending action on workspace switch', async () => {
    const { management, config, entries } = setup({ dirty: ['/draft.txt'] })
    const pending = management.remove(entries[0]!.manifest)
    management.reset()
    expect((await pending).ok).toBe(false)
    expect(config.removeEntry).not.toHaveBeenCalled()
    expect(management.getSnapshot().pending).toBeNull()
  })
})
