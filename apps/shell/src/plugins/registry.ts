import { compileGlob, matchGlob } from './glob'
import type { RegisteredEditor } from './registration'

export interface EditorCandidate extends RegisteredEditor {
  identity: string
  pluginOrder: number
}

interface Entry {
  candidate: EditorCandidate
  regex: RegExp
}

/**
 * The active editor contributions for one workspace. The first candidate from
 * `match` is the selected editor; the rest are "Open with..." alternatives.
 * Ordering is priority descending, then `exo.json` declaration order, then the
 * registration order inside the plugin.
 */
export class EditorRegistry {
  private readonly byPlugin = new Map<string, Entry[]>()

  add(identity: string, pluginOrder: number, editors: RegisteredEditor[]): void {
    const entries: Entry[] = []
    for (const editor of editors) {
      const compiled = compileGlob(editor.glob)
      if (!compiled.ok) continue
      entries.push({
        candidate: { ...editor, identity, pluginOrder },
        regex: compiled.regex,
      })
    }
    this.byPlugin.set(identity, entries)
  }

  remove(identity: string): void {
    this.byPlugin.delete(identity)
  }

  clear(): void {
    this.byPlugin.clear()
  }

  all(): EditorCandidate[] {
    return [...this.byPlugin.values()].flatMap((entries) => entries.map((entry) => entry.candidate))
  }

  match(path: string): EditorCandidate[] {
    const candidates: EditorCandidate[] = []
    for (const entries of this.byPlugin.values()) {
      for (const entry of entries) {
        if (matchGlob(entry.regex, path)) candidates.push(entry.candidate)
      }
    }
    return candidates.sort(
      (left, right) =>
        right.priority - left.priority ||
        left.pluginOrder - right.pluginOrder ||
        left.registrationOrder - right.registrationOrder,
    )
  }
}
