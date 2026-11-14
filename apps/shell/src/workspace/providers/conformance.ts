import { describe, expect, it } from 'vitest'
import type { WorkspaceErrorCode, WorkspaceProvider } from '../contract'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function expectCode(
  operation: () => Promise<unknown>,
  code: WorkspaceErrorCode,
): Promise<void> {
  await expect(operation()).rejects.toMatchObject({ code })
}

function bytes(text: string): Uint8Array {
  return encoder.encode(text)
}

function text(data: Uint8Array): string {
  return decoder.decode(data)
}

async function seeded(provider: WorkspaceProvider) {
  const handle = await provider.open()
  await handle.write('/a.txt', bytes('alpha'), { create: true })
  return handle
}

/**
 * The provider conformance suite. It is run against every implementation so the
 * memory provider stays the reference oracle and the folder provider cannot
 * drift on paths, versions, errors or dispose.
 */
export function runProviderConformance(
  label: string,
  createProvider: () => WorkspaceProvider,
): void {
  describe(`${label} provider conformance`, () => {
    it('reports the contract capabilities and a descriptor', async () => {
      const provider = createProvider()
      const capabilities = provider.capabilities()

      expect(typeof capabilities.writable).toBe('boolean')
      expect(typeof capabilities.watchable).toBe('boolean')
      expect(typeof capabilities.persistent).toBe('boolean')
      expect(typeof capabilities.caseSensitive).toBe('boolean')

      const handle = await provider.open()
      expect(handle.descriptor.capabilities).toEqual(capabilities)
      expect(handle.descriptor.providerKind).toBe(provider.kind)
      expect(handle.descriptor.name.length).toBeGreaterThan(0)
    })

    it('lists directories, reads bytes and round-trips writes', async () => {
      const handle = await seeded(createProvider())
      await handle.mkdir('/docs')
      await handle.write('/docs/readme.md', bytes('hello'), { create: true })

      const root = await handle.list('/')
      expect(root.map((entry) => entry.path)).toEqual(expect.arrayContaining(['/a.txt', '/docs']))

      const docs = await handle.list('/docs')
      expect(docs).toHaveLength(1)
      expect(docs[0]).toMatchObject({ path: '/docs/readme.md', kind: 'file' })

      const read = await handle.read('/a.txt')
      expect(text(read)).toBe('alpha')
      read.fill(0)
      expect(text(await handle.read('/a.txt'))).toBe('alpha')
    })

    it('changes the version on content changes and keeps it stable otherwise', async () => {
      const handle = await seeded(createProvider())
      const first = await handle.stat('/a.txt')
      const again = await handle.stat('/a.txt')

      expect(again.version).toBe(first.version)
      const second = await handle.write('/a.txt', bytes('beta'), {
        ifVersion: first.version,
      })
      expect(second.version).not.toBe(first.version)
      expect(text(await handle.read('/a.txt'))).toBe('beta')
    })

    it('rejects a stale ifVersion without overwriting', async () => {
      const handle = await seeded(createProvider())
      const loaded = await handle.stat('/a.txt')
      await handle.write('/a.txt', bytes('newer'))
      await expectCode(
        () => handle.write('/a.txt', bytes('stale'), { ifVersion: loaded.version }),
        'conflict',
      )
      expect(text(await handle.read('/a.txt'))).toBe('newer')
    })

    it('creates and removes directories', async () => {
      const handle = await seeded(createProvider())
      await handle.mkdir('/nested/deep', { recursive: true })

      expect((await handle.stat('/nested/deep')).kind).toBe('directory')
      expect((await handle.list('/nested')).map((entry) => entry.path)).toEqual(['/nested/deep'])

      await handle.remove('/nested', { recursive: true })
      await expectCode(() => handle.stat('/nested'), 'not-found')
    })

    it('moves a path and reports the new stat', async () => {
      const handle = await seeded(createProvider())
      const moved = await handle.move('/a.txt', '/b.txt')

      expect(moved).toMatchObject({ path: '/b.txt', kind: 'file' })
      expect(text(await handle.read('/b.txt'))).toBe('alpha')
      await expectCode(() => handle.stat('/a.txt'), 'not-found')
    })

    it('uses the stable error codes', async () => {
      const handle = await seeded(createProvider())
      await handle.mkdir('/docs')

      await expectCode(() => handle.read('/missing.txt'), 'not-found')
      await expectCode(() => handle.read('/docs'), 'not-a-file')
      await expectCode(() => handle.list('/a.txt'), 'not-a-directory')
      await expectCode(() => handle.mkdir('/docs'), 'already-exists')
      await expectCode(() => handle.write('/missing/child.txt', bytes('x')), 'not-found')
      await handle.write('/target.txt', bytes('t'), { create: true })
      await expectCode(() => handle.move('/a.txt', '/target.txt'), 'already-exists')
    })

    it('honours maxBytes and abort before a call', async () => {
      const handle = await seeded(createProvider())
      await expectCode(() => handle.read('/a.txt', { maxBytes: 2 }), 'too-large')

      const controller = new AbortController()
      controller.abort()
      await expectCode(
        () => handle.write('/a.txt', bytes('nope'), { signal: controller.signal }),
        'aborted',
      )
      expect(text(await handle.read('/a.txt'))).toBe('alpha')
    })

    it('rejects every operation after dispose', async () => {
      const provider = createProvider()
      const handle = await provider.open()
      provider.dispose()

      await expectCode(() => handle.stat('/'), 'io')
      await expectCode(() => provider.open(), 'io')
    })

    it('watches changes in operation order when watchable', async () => {
      const provider = createProvider()
      const handle = await provider.open()
      if (!provider.capabilities().watchable || !handle.watch) {
        expect(handle.watch).toBeUndefined()
        return
      }

      const changes: string[] = []
      const registration = handle.watch(['/'], (change) => {
        changes.push(`${change.kind}:${change.path}`)
      })

      await handle.write('/watched.txt', bytes('1'), { create: true })
      await handle.write('/watched.txt', bytes('2'))
      registration.dispose()
      await handle.write('/watched.txt', bytes('3'))

      expect(changes).toEqual(['created:/watched.txt', 'changed:/watched.txt'])
    })

    it('reports recursive listings in path order', async () => {
      const handle = await seeded(createProvider())
      await handle.mkdir('/dir')
      await handle.write('/dir/b.txt', bytes('b'), { create: true })
      await handle.write('/dir/a.txt', bytes('a'), { create: true })

      const recursive = await handle.list('/', { depth: 'recursive' })
      const paths = recursive.map((entry) => entry.path)

      expect(paths).toEqual([...paths].sort())
      expect(paths).toEqual(expect.arrayContaining(['/a.txt', '/dir', '/dir/a.txt', '/dir/b.txt']))
    })
  })
}

export { bytes, text }
