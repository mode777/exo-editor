import { describe, expect, it } from 'vitest'
import { MemoryWorkspaceProvider } from './memory'
import { runProviderConformance, text } from './conformance'

runProviderConformance('memory', () => new MemoryWorkspaceProvider())

describe('memory provider determinism', () => {
  it('produces identical paths, versions and mtimes for the same operations', async () => {
    const run = async () => {
      let clock = 1000
      const provider = new MemoryWorkspaceProvider({ now: () => clock++ })
      const handle = await provider.open()
      await handle.mkdir('/docs')
      await handle.write('/docs/a.txt', new TextEncoder().encode('one'), {
        create: true,
      })
      await handle.write('/docs/a.txt', new TextEncoder().encode('two'))
      await handle.write('/docs/b.txt', new TextEncoder().encode('three'), {
        create: true,
      })
      const a = await handle.stat('/docs/a.txt')
      const b = await handle.stat('/docs/b.txt')
      const list = await handle.list('/docs')
      provider.dispose()
      return { a, b, list }
    }

    expect(await run()).toEqual(await run())
  })

  it('starts versions at m1 and increments only on content changes', async () => {
    const provider = new MemoryWorkspaceProvider({ now: () => 42 })
    const handle = await provider.open()

    const created = await handle.write('/a.txt', new TextEncoder().encode('a'), {
      create: true,
    })
    expect(created.version).toBe('m1')
    expect(created.mtime).toBe(42)

    const changed = await handle.write('/a.txt', new TextEncoder().encode('b'))
    expect(changed.version).toBe('m2')
    expect((await handle.stat('/a.txt')).version).toBe('m2')
  })

  it('does not emit a watch change for an aborted operation', async () => {
    const provider = new MemoryWorkspaceProvider()
    const handle = await provider.open()
    const changes: string[] = []
    handle.watch?.(['/'], (change) => changes.push(change.kind))

    const controller = new AbortController()
    controller.abort()
    await expect(
      handle.write('/a.txt', new TextEncoder().encode('x'), {
        create: true,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'aborted' })

    expect(changes).toEqual([])
  })

  it('rejects writes when declared read-only', async () => {
    const provider = new MemoryWorkspaceProvider({ writable: false })
    const handle = await provider.open()
    await expect(
      handle.write('/a.txt', new TextEncoder().encode('x'), { create: true }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    expect(provider.capabilities().writable).toBe(false)
  })

  it('seeds initial content deterministically', async () => {
    const provider = new MemoryWorkspaceProvider({
      now: () => 7,
      initialFiles: { '/hello.txt': 'hello' },
      initialDirectories: ['/docs'],
    })
    const handle = await provider.open()

    expect(text(await handle.read('/hello.txt'))).toBe('hello')
    expect((await handle.stat('/docs')).kind).toBe('directory')
  })
})
