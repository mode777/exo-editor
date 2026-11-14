import { useWorkbenchStore } from 'vscode-workbench'
import { describe, expect, it, vi } from 'vitest'
import { createExoCommandRegistry } from './commands'

describe('exo command registry', () => {
  it('exposes the workspace-free commands', () => {
    const registry = createExoCommandRegistry({ openSettings: () => undefined })
    const ids = registry.list().map((command) => command.id)

    expect(ids).toContain('exo.theme.toggle')
    expect(ids).toContain('exo.settings.open')
    expect(ids).toContain('view.togglePrimary')
    expect(ids).toContain('view.resetLayout')
  })

  it('omits commands that need a workspace', () => {
    const registry = createExoCommandRegistry({ openSettings: () => undefined })
    const ids = registry.list().map((command) => command.id)

    for (const id of [
      'file.new',
      'file.open',
      'file.save',
      'file.saveAll',
      'file.close',
      'exo.workspace.open',
      // Replaced by exo.theme.toggle.
      'view.toggleTheme',
    ]) {
      expect(ids).not.toContain(id)
    }
  })

  it('opens the settings surface through its handler', () => {
    const openSettings = vi.fn()
    const registry = createExoCommandRegistry({ openSettings })

    expect(registry.run('exo.settings.open')).toBe(true)
    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  it('toggles the theme immediately', () => {
    const registry = createExoCommandRegistry({ openSettings: () => undefined })
    const initial = useWorkbenchStore.getState().theme

    registry.run('exo.theme.toggle')
    expect(useWorkbenchStore.getState().theme).not.toBe(initial)

    registry.run('exo.theme.toggle')
    expect(useWorkbenchStore.getState().theme).toBe(initial)
  })
})
