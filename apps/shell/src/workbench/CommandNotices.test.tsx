import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRuntimeProvider } from '../workspace/context'
import type { WorkspaceRuntime } from '../workspace/runtime'
import {
  COMMAND_NOTICE_TIMEOUT_MS,
  PluginCommandController,
  type CommandEntry,
  type CommandHost,
  type CommandTargetSession,
} from '../plugins/commands'
import type { Envelope } from '../plugins/protocol'
import { CommandNotices } from './CommandNotices'

const IDENTITY = 'https://plugins.example.com::com.example.test'

function entry(): CommandEntry {
  return {
    identity: IDENTITY,
    pluginId: 'com.example.test',
    pluginName: 'Example Plugin',
    pluginVersion: '1.0.0',
    origin: 'https://plugins.example.com',
    pluginOrder: 0,
    command: {
      id: 'format',
      title: 'Format Document',
      target: 'activeEditor',
      menus: ['commandPalette'],
      registrationOrder: 0,
    },
  }
}

class FakeHost implements CommandHost {
  readonly entry = entry()
  readonly logs: unknown[] = []
  listCommands(): CommandEntry[] {
    return [this.entry]
  }
  findCommand(identity: string, commandId: string): CommandEntry | undefined {
    return identity === this.entry.identity && commandId === this.entry.command.id
      ? this.entry
      : undefined
  }
  logCommand(): void {
    // Not under test here.
  }
}

class FakeSession implements CommandTargetSession {
  active = true
  private resultListener: ((envelope: Envelope) => void) | null = null
  sendCommand(): boolean {
    return true
  }
  onCommandResult(listener: (envelope: Envelope) => void): () => void {
    this.resultListener = listener
    return () => {
      this.resultListener = null
    }
  }
  onClosed(): () => void {
    return () => undefined
  }
  fail(replyTo: string, message: string): void {
    this.resultListener?.({
      exo: 1,
      type: 'plugin/command-result',
      replyTo,
      payload: { ok: false, message },
    })
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

async function render(controller: PluginCommandController) {
  const runtime = { commands: controller } as unknown as WorkspaceRuntime
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <WorkspaceRuntimeProvider runtime={runtime}>
        <CommandNotices />
      </WorkspaceRuntimeProvider>,
    ),
  )
  return container
}

describe('command notices', () => {
  it('renders a bounded failure notice and dismisses it manually', async () => {
    const session = new FakeSession()
    const controller = new PluginCommandController({
      host: new FakeHost(),
      activeEditor: () => session,
    })
    await controller.invoke(IDENTITY, 'format', 'palette')
    session.fail('cmd-1', 'No selection')
    const rendered = await render(controller)
    expect(rendered.querySelector('[role="status"]')).not.toBeNull()
    expect(rendered.textContent).toContain('Example Plugin: No selection')
    const dismiss = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.getAttribute('aria-label')?.includes('Example Plugin'),
    )
    await act(async () => dismiss?.click())
    expect(rendered.querySelector('[role="status"]')).toBeNull()
  })

  it('auto-dismisses after the notice timeout and stays silent on success', async () => {
    vi.useFakeTimers()
    const session = new FakeSession()
    const controller = new PluginCommandController({
      host: new FakeHost(),
      activeEditor: () => session,
    })
    await controller.invoke(IDENTITY, 'format', 'palette')
    session.fail('cmd-1', 'No selection')
    const rendered = await render(controller)
    expect(rendered.textContent).toContain('No selection')
    await act(async () => {
      vi.advanceTimersByTime(COMMAND_NOTICE_TIMEOUT_MS)
    })
    expect(controller.getSnapshot().notices).toEqual([])
    expect(rendered.querySelector('[role="status"]')).toBeNull()
  })
})
