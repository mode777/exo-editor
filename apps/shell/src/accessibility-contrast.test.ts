import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Exo-owned CSS takes its text and focus colours from the pinned workbench
// theme tokens. jsdom cannot compute contrast, so this parses the two palettes
// and checks the pairs Exo actually uses. A kit upgrade that lowers contrast
// fails here and must update docs/accessibility.md.

interface Palette {
  [name: string]: string
}

interface ContrastPair {
  foreground: string
  background: string
  minimum: number
  label: string
}

const TEXT_PAIRS: ContrastPair[] = [
  {
    foreground: 'foreground',
    background: 'sideBar-background',
    minimum: 4.5,
    label: 'explorer text',
  },
  {
    foreground: 'descriptionForeground',
    background: 'sideBar-background',
    minimum: 4.5,
    label: 'explorer hint text',
  },
  {
    foreground: 'list-activeSelectionForeground',
    background: 'list-activeSelectionBackground',
    minimum: 4.5,
    label: 'selected tree row',
  },
  {
    foreground: 'editor-foreground',
    background: 'editor-background',
    minimum: 4.5,
    label: 'document text',
  },
  {
    foreground: 'button-foreground',
    background: 'button-background',
    minimum: 4.5,
    label: 'primary button text',
  },
  {
    foreground: 'input-foreground',
    background: 'input-background',
    minimum: 4.5,
    label: 'input text',
  },
  {
    foreground: 'statusBar-foreground',
    background: 'statusBar-background',
    minimum: 4.5,
    label: 'status bar text',
  },
  {
    foreground: 'badge-foreground',
    background: 'badge-background',
    minimum: 4.5,
    label: 'badge text',
  },
]

const FOCUS_PAIRS: ContrastPair[] = [
  {
    foreground: 'focusBorder',
    background: 'sideBar-background',
    minimum: 3,
    label: 'explorer focus ring',
  },
  {
    foreground: 'focusBorder',
    background: 'editor-background',
    minimum: 3,
    label: 'document focus ring',
  },
  {
    foreground: 'list-activeSelectionForeground',
    background: 'list-activeSelectionBackground',
    minimum: 3,
    label: 'selected tree row focus ring',
  },
  {
    foreground: 'list-activeSelectionForeground',
    background: 'sideBar-background',
    minimum: 3,
    label: 'unselected tree row focus ring',
  },
]

function tokenFile(): string {
  let directory = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'node_modules/vscode-workbench/dist/styles/tokens.css')
    if (existsSync(candidate)) return candidate
    directory = dirname(directory)
  }
  throw new Error('Could not find the pinned vscode-workbench tokens.css.')
}

function palette(css: string, theme: 'dark' | 'light'): Palette {
  const block = css.match(new RegExp(`:root\\[data-theme='${theme}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!block) throw new Error(`No ${theme} palette in tokens.css.`)
  const values: Palette = {}
  for (const match of block[1].matchAll(/--vscode-([a-zA-Z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    values[match[1]] = match[2]
  }
  return values
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : value.slice(0, 6)
  const channels = [0, 2, 4].map((offset) => channel(full, offset) / 255)
  const linear = channels.map((part) =>
    part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function assertPairs(values: Palette, pairs: ContrastPair[]) {
  for (const pair of pairs) {
    const foreground = values[pair.foreground]
    const background = values[pair.background]
    if (!foreground || !background) {
      throw new Error(`Missing token for ${pair.label}: ${pair.foreground} / ${pair.background}`)
    }
    const ratio = contrastRatio(foreground, background)
    expect(
      ratio,
      `${pair.label}: ${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(pair.minimum)
  }
}

describe('theme contrast for Exo-owned surfaces', () => {
  const css = readFileSync(tokenFile(), 'utf8')

  it.each(['dark', 'light'] as const)('%s theme text meets WCAG AA', (theme) => {
    assertPairs(palette(css, theme), TEXT_PAIRS)
  })

  it.each(['dark', 'light'] as const)('%s theme focus indicators meet 3:1', (theme) => {
    assertPairs(palette(css, theme), FOCUS_PAIRS)
  })

  it('detects a pair below the documented threshold', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
    expect(() =>
      assertPairs({ foreground: '#777777', background: '#ffffff' }, [
        {
          foreground: 'foreground',
          background: 'background',
          minimum: 4.5,
          label: 'synthetic low-contrast pair',
        },
      ]),
    ).toThrow()
  })
})
