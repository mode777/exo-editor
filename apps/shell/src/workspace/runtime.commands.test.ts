import { describe, expect, it, vi } from 'vitest'
import { WorkspaceRuntime } from './runtime'
import { MemoryWorkspaceProvider } from './providers/memory'
import { MemoryHandleStore } from './providers/folder/handle-store'

function runtime(): WorkspaceRuntime {
  return new WorkspaceRuntime({
    providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
  })
}

describe('runtime command teardown', () => {
  it('resets the command controller on workspace switch and dispose', async () => {
    const instance = runtime()
    await instance.openFolder()
    const reset = vi.spyOn(instance.commands, 'reset')
    await instance.disconnect()
    expect(reset).toHaveBeenCalled()
    expect(instance.commands.getSnapshot().notices).toEqual([])

    await instance.openFolder()
    reset.mockClear()
    await instance.dispose()
    expect(reset).toHaveBeenCalled()
  })

  it('clears notices left by an invocation when the workspace switches', async () => {
    const instance = runtime()
    await instance.openFolder()
    const controller = instance.commands
    // A notice is only produced through an invocation; drive the same path by
    // stubbing the host lookup and a target session.
    const session = {
      active: true,
      sendCommand: () => true,
      onCommandResult: (listener: (envelope: unknown) => void) => {
        queueMicrotask(() =>
          listener({
            exo: 1,
            type: 'plugin/command-result',
            replyTo: 'cmd-1',
            payload: { ok: false, message: 'failed' },
          }),
        )
        return () => undefined
      },
      onClosed: () => () => undefined,
    }
    vi.spyOn(instance.pluginHost, 'findCommand').mockReturnValue({
      identity: 'https://plugins.example.com::com.example.test',
      pluginId: 'com.example.test',
      pluginName: 'Example Plugin',
      pluginVersion: '1.0.0',
      origin: 'https://plugins.example.com',
      pluginOrder: 0,
      command: {
        id: 'format',
        title: 'Format',
        target: 'activeEditor',
        menus: ['commandPalette'],
        registrationOrder: 0,
      },
    })
    ;(
      controller as unknown as {
        activeEditor: (identity: string) => typeof session
      }
    ).activeEditor = () => session
    await controller.invoke('https://plugins.example.com::com.example.test', 'format', 'palette')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getSnapshot().notices).toHaveLength(1)
    await instance.disconnect()
    expect(controller.getSnapshot().notices).toEqual([])
  })
})
