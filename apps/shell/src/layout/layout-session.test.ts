import { beforeEach, describe, expect, it, vi } from 'vitest'

// The preset owns the layout session. These tests pin the behaviour the spec
// depends on: layout and theme are persisted, restored on reload, and a missing
// or corrupt stored value falls back to the documented defaults instead of
// breaking the shell.
const PERSIST_KEY = 'desktop-ui-template:v1'

async function loadKit() {
  vi.resetModules()
  return import('vscode-workbench')
}

describe('layout session persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('writes layout and theme under the versioned preset key', async () => {
    const kit = await loadKit()

    kit.useWorkbenchStore.getState().setPrimarySideBarWidth(420)
    kit.useWorkbenchStore.getState().setTheme('light')

    const raw = localStorage.getItem(PERSIST_KEY)
    expect(raw).toBeTruthy()

    const envelope = JSON.parse(raw as string) as {
      version: number
      state: { primarySideBarWidth: number; theme: string }
    }
    expect(envelope.version).toBe(1)
    expect(envelope.state.primarySideBarWidth).toBe(420)
    expect(envelope.state.theme).toBe('light')
  })

  it('restores layout and theme after a reload', async () => {
    const first = await loadKit()
    first.useWorkbenchStore.getState().setPrimarySideBarWidth(420)
    first.useWorkbenchStore.getState().setTheme('light')

    const second = await loadKit()
    const state = second.useWorkbenchStore.getState()

    expect(state.primarySideBarWidth).toBe(420)
    expect(state.theme).toBe('light')
  })

  it('falls back to the default layout when stored state is corrupt', async () => {
    localStorage.setItem(PERSIST_KEY, '{this is not json')

    const kit = await loadKit()
    const state = kit.useWorkbenchStore.getState()

    expect(state.primarySideBarWidth).toBe(kit.DEFAULT_PRIMARY_SIDE_BAR_WIDTH)
    expect(state.theme).toBe('dark')
  })

  it('falls back to the default layout when no state is stored', async () => {
    const kit = await loadKit()
    const state = kit.useWorkbenchStore.getState()

    expect(state.primarySideBarWidth).toBe(kit.DEFAULT_PRIMARY_SIDE_BAR_WIDTH)
    expect(state.bottomPanelHeight).toBe(kit.DEFAULT_BOTTOM_PANEL_HEIGHT)
  })
})
