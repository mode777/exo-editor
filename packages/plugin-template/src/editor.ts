import type { FileChangedPayload, SaveResult } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { withSaveMarker } from './marker'
import { errorDetails, renderObservation } from './observation'

interface EditorState {
  mode: 'editor'
  phase: 'starting' | 'active' | 'disposed' | 'error'
  file: { path: string; version: string; size: number } | null
  reads: Array<{ path: string; version: string; length: number }>
  saves: number[]
  lastSave: SaveResult | null
  external: FileChangedPayload | null
  dirty: boolean
  disposed: string | null
  errors: Array<{ code?: string; message: string }>
}

async function main(): Promise<void> {
  const state: EditorState = {
    mode: 'editor',
    phase: 'starting',
    file: null,
    reads: [],
    saves: [],
    lastSave: null,
    external: null,
    dirty: false,
    disposed: null,
    errors: [],
  }
  const render = () => {
    renderObservation(state, `Exo template editor ${state.phase} saves:${state.saves.length}`)
  }
  render()

  try {
    const connection = await connectBrowserPlugin()
    if (connection.mode !== 'editor') {
      throw new Error('The editor entry must be mounted in editor mode.')
    }
    const editor = connection.editor
    let path = editor.file.path
    let buffer = ''
    let saveNumber = 0

    state.phase = 'active'
    state.file = {
      path: editor.file.path,
      version: editor.file.version,
      size: editor.file.size,
    }
    render()

    const reload = async (): Promise<void> => {
      const content = await editor.readFile(path, 'utf8')
      buffer = content.text
      state.reads.push({
        path: content.path,
        version: content.version,
        length: content.text.length,
      })
      if (state.file) state.file.version = content.version
      render()
    }

    editor.onSaveRequest(() => {
      saveNumber += 1
      buffer = withSaveMarker(buffer, saveNumber)
      state.saves.push(saveNumber)
      render()
      return { text: buffer }
    })

    editor.onSaveResult((result) => {
      state.lastSave = result
      if (result.ok) {
        state.dirty = false
        editor.setDirty(false)
        if (state.file) state.file.version = result.version
      }
      render()
    })

    editor.onFileChanged((change) => {
      state.external = change
      if (change.kind === 'renamed') path = change.path
      if (change.kind !== 'deleted') {
        void reload().catch((error: unknown) => {
          state.errors.push(errorDetails(error))
          render()
        })
        state.dirty = true
        editor.setDirty(true)
      }
      render()
    })

    editor.onError((error) => {
      state.errors.push({
        code: error.code,
        message: error.message ?? error.code,
      })
      render()
    })

    editor.onDispose((reason) => {
      state.disposed = reason
      state.phase = 'disposed'
      render()
    })

    await reload()
    state.dirty = true
    editor.setDirty(true)
    render()
    console.log('EXO_TEMPLATE_EDITOR_READY', editor.file.path, editor.file.version)
  } catch (error) {
    state.phase = 'error'
    state.errors.push(errorDetails(error))
    render()
    console.error('EXO_TEMPLATE_EDITOR_ERROR', errorDetails(error))
  }
}

void main()
