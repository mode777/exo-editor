import type { PluginPermission } from './manifest'
import { compileGlob, matchGlob } from './glob'
import type { RegisteredEditor } from './registration'

export interface EditorPluginInfo {
  identity: string
  pluginOrder: number
  pluginName: string
  pluginId: string
  pluginVersion: string
  origin: string
  permissions: PluginPermission[]
}

export interface EditorCandidate extends RegisteredEditor {
  identity: string
  pluginOrder: number
  pluginName: string
  pluginId: string
  pluginVersion: string
  origin: string
  permissions: PluginPermission[]
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

  add(plugin: EditorPluginInfo, editors: RegisteredEditor[]): void {
    const entries: Entry[] = []
    for (const editor of editors) {
      const compiled = compileGlob(editor.glob)
      if (!compiled.ok) continue
      entries.push({
        candidate: {
          ...editor,
          identity: plugin.identity,
          pluginOrder: plugin.pluginOrder,
          pluginName: plugin.pluginName,
          pluginId: plugin.pluginId,
          pluginVersion: plugin.pluginVersion,
          origin: plugin.origin,
          permissions: plugin.permissions,
        },
        regex: compiled.regex,
      })
    }
    this.byPlugin.set(plugin.identity, entries)
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
