import { describe, expect, it, vi } from 'vitest'
import { MarketplaceStore } from './store'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'

const SOURCE_URL = 'https://shell.example.com/marketplace-sources.json'
const FEED_URL = 'https://shell.example.com/marketplace.json'

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  })
}

function store() {
  return new MarketplaceStore({
    sourceUrl: SOURCE_URL,
    fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === SOURCE_URL) return response({ schemaVersion: 1, feeds: [FEED_URL] })
      if (url === FEED_URL) {
        return response({
          schemaVersion: 1,
          id: 'test-feed',
          name: 'Test Feed',
          owner: { name: 'Example' },
          plugins: [{ name: 'Plugin', manifest: 'https://plugins.example.com/exo-manifest.json' }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as never,
  })
}

async function runtime(marketplace: MarketplaceStore): Promise<WorkspaceRuntime> {
  const provider = new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} })
  const instance = new WorkspaceRuntime({
    marketplace,
    providerFactory: () => provider,
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
  })
  await instance.start()
  return instance
}

describe('runtime marketplace integration', () => {
  it('keeps the deployment-scoped catalog across a workspace switch', async () => {
    const marketplace = store()
    const instance = await runtime(marketplace)
    await instance.openFolder()
    await marketplace.ensureLoaded()
    expect(marketplace.getSnapshot().plugins).toHaveLength(1)

    await instance.disconnect()
    expect(marketplace.getSnapshot().plugins).toHaveLength(1)
    await instance.openFolder()
    expect(marketplace.getSnapshot().plugins).toHaveLength(1)
    await instance.dispose()
  })

  it('disposes the catalog with the runtime', async () => {
    const marketplace = store()
    const instance = await runtime(marketplace)
    await marketplace.ensureLoaded()
    await instance.dispose()
    expect(marketplace.getSnapshot()).toMatchObject({
      phase: 'idle',
      sourceStatus: 'idle',
      plugins: [],
    })
  })
})
