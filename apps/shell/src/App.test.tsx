import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'

describe('empty shell composition', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders the workbench with an explicit empty explorer state', async () => {
    await act(async () => root.render(<App />))

    expect(container.textContent).toContain('No workspace is open.')
    expect(container.textContent).toContain('No editors are open')
    expect(container.querySelector('[role="region"][aria-label="Explorer"]')).not.toBeNull()
  })

  it('reports the workspace-free status bar', async () => {
    await act(async () => root.render(<App />))

    expect(container.textContent).toContain('No workspace')
    expect(container.textContent).toContain('Theme: dark')
  })

  it('applies the theme to the document root', async () => {
    await act(async () => root.render(<App />))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('lists the workspace-free commands in the palette and opens settings', async () => {
    await act(async () => root.render(<App />))
    await act(async () => {
      useWorkbenchStore.getState().setQuickOpen(true, 'commands')
    })
    const palette = document.querySelector('[role="dialog"][aria-label="Command palette"]')
    expect(palette).not.toBeNull()
    expect(palette?.textContent).toContain('Toggle Theme')
    expect(palette?.textContent).toContain('Open Settings')

    const settingsEntry = Array.from(palette?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Open Settings'),
    )
    expect(settingsEntry).toBeDefined()
    await act(async () => settingsEntry?.click())

    expect(
      document.querySelector('[role="dialog"][aria-labelledby="exo-settings-title"]'),
    ).not.toBeNull()
  })

  it('shows an explicit unsupported state instead of mock files', async () => {
    await act(async () => root.render(<App />))

    expect(container.textContent).toContain('No workspace is open.')
    expect(container.textContent).toContain('Chromium')
    expect(container.textContent).toContain('No workspace · Unsupported browser')
    expect(container.querySelector('.exo-tree-row')).toBeNull()
  })

  it('opens the command palette from the status bar button', async () => {
    await act(async () => root.render(<App />))

    const button = container.querySelector<HTMLButtonElement>('.exo-status-button')
    expect(button).not.toBeNull()
    await act(async () => button?.click())

    expect(document.querySelector('[role="dialog"][aria-label="Command palette"]')).not.toBeNull()
  })
})
