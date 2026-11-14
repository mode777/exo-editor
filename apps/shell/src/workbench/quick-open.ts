import type { QuickOpenProvider } from 'vscode-workbench'

// Layer 1 has no files. The provider exists so the composition seam is real,
// and it reports an explicitly empty source rather than mock paths.
export function createQuickOpenProvider(): QuickOpenProvider {
  return {
    files: [],
    openFile: () => undefined,
  }
}
