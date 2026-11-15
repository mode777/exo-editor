import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeSync } from './theme-sync'
import { configurePresetStore } from './workbench/tabs'

describe('theme sync', () => {
  let root: Root | null = null

  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
  })

  async function mount(onChange: (theme: 'dark' | 'light' | 'high-contrast') => void) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root?.render(<ThemeSync onChange={onChange} />))
  }

  it('applies the theme without publishing the initial value', async () => {
    const onChange = vi.fn()
    await mount(onChange)
    expect(document.documentElement.dataset.theme).toBe(useWorkbenchStore.getState().theme)
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => root?.unmount())
    root = null
  })

  it('publishes one change per theme switch', async () => {
    const onChange = vi.fn()
    await mount(onChange)
    const next = useWorkbenchStore.getState().theme === 'dark' ? 'light' : 'dark'

    await act(async () => useWorkbenchStore.getState().setTheme(next))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(next)
    expect(document.documentElement.dataset.theme).toBe(next)
    await act(async () => root?.unmount())
    root = null
  })
})
