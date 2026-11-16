import type { FileChangedPayload, SaveResult } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker&inline'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker&inline'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker&inline'
import './editor.css'
import { shouldClearDirty } from './dirty'
import {
  canOpenInMonaco,
  formatBytes,
  languageForPath,
  monacoThemeFor,
  tooLargeMessage,
} from './languages'

globalThis.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') return new JsonWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

const notice = document.getElementById('notice') as HTMLDivElement
const editorRoot = document.getElementById('editor') as HTMLDivElement
const pathLabel = document.getElementById('path') as HTMLSpanElement
const stateLabel = document.getElementById('state') as HTMLSpanElement

function setNotice(message: string | null): void {
  notice.hidden = message === null
  notice.textContent = message ?? ''
}

function renderStatus(path: string, language: string, dirty: boolean, detail: string): void {
  pathLabel.textContent = path
  stateLabel.textContent = `${language} · ${dirty ? 'Unsaved' : 'Saved'}${detail ? ` · ${detail}` : ''}`
}

async function main(): Promise<void> {
  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'editor') {
    throw new Error('The editor entry must be mounted in editor mode.')
  }

  const client = connection.editor
  let currentPath = client.file.path
  let dirty = false
  let applying = true
  let changeGeneration = 0
  let pendingSaveGeneration: number | null = null
  let language = languageForPath(currentPath)

  pathLabel.textContent = currentPath
  renderStatus(currentPath, language, false, formatBytes(client.file.size))
  setNotice(null)

  if (!canOpenInMonaco(client.file.size, client.limits)) {
    setNotice(tooLargeMessage(client.file.size))
    renderStatus(currentPath, language, false, 'Too large')
    client.setDirty(false)
    return
  }

  const content = await client.readFile(currentPath, 'utf8')
  currentPath = content.path
  pathLabel.textContent = currentPath

  const model = monaco.editor.createModel(content.text, language, monaco.Uri.file(currentPath))
  const editor = monaco.editor.create(editorRoot, {
    model,
    theme: monacoThemeFor(client.initialization.theme),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    wordWrap: language === 'markdown' ? 'on' : 'off',
    readOnly: !client.capabilities.write,
    tabSize: 2,
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: 13,
  })
  applying = false

  const markDirty = (next: boolean): void => {
    if (dirty === next) return
    dirty = next
    client.setDirty(next)
    renderStatus(currentPath, language, dirty, formatBytes(client.file.size))
  }

  const applyContent = (text: string, nextPath: string): void => {
    applying = true
    model.setValue(text)
    currentPath = nextPath
    language = languageForPath(currentPath)
    monaco.editor.setModelLanguage(model, language)
    applying = false
    pathLabel.textContent = currentPath
    markDirty(false)
    setNotice(null)
    renderStatus(currentPath, language, false, formatBytes(client.file.size))
  }

  model.onDidChangeContent(() => {
    if (applying) return
    changeGeneration += 1
    markDirty(true)
    setNotice(null)
  })

  client.onSaveRequest(() => {
    pendingSaveGeneration = changeGeneration
    return { text: model.getValue() }
  })

  client.onSaveResult((result: SaveResult) => {
    const savedGeneration = pendingSaveGeneration
    pendingSaveGeneration = null
    if (!result.ok) {
      setNotice(`Save failed: ${result.code}. Your edits are still here.`)
      renderStatus(currentPath, language, dirty, formatBytes(client.file.size))
      return
    }
    if (shouldClearDirty(savedGeneration, changeGeneration)) markDirty(false)
    setNotice(null)
    renderStatus(currentPath, language, dirty, formatBytes(client.file.size))
  })

  client.onFileChanged((change: FileChangedPayload) => {
    if (change.kind === 'deleted') {
      setNotice('This file was deleted on disk. Saving will fail; the tab stays dirty.')
      renderStatus(currentPath, language, dirty, 'Deleted on disk')
      return
    }
    if (change.kind === 'renamed') {
      currentPath = change.path
      pathLabel.textContent = currentPath
    }
    if (dirty) {
      setNotice(
        'This file changed on disk. Saving may conflict; use the shell Reload action to discard.',
      )
      renderStatus(currentPath, language, dirty, 'Changed on disk')
      return
    }
    void client
      .readFile(currentPath, 'utf8')
      .then((next) => {
        applyContent(next.text, next.path)
        renderStatus(currentPath, language, false, formatBytes(client.file.size))
      })
      .catch((error: unknown) => {
        setNotice(`Could not reload the file: ${String(error)}`)
      })
  })

  client.onError((error) => {
    setNotice(`${error.code}${error.message ? `: ${error.message}` : ''}`)
  })

  client.onDispose((reason) => {
    setNotice(`Editor closed (${reason}).`)
    editor.dispose()
    model.dispose()
  })

  const permissions = client.initialization.permissions
  if (permissions.includes('events:subscribe')) {
    try {
      await client.subscribe('theme/changed')
      client.onEvent('theme/changed', (event) => {
        monaco.editor.setTheme(monacoThemeFor(event.payload.theme))
      })
    } catch (error) {
      setNotice(`Theme updates are unavailable: ${String(error)}`)
    }
  }

  renderStatus(currentPath, language, dirty, formatBytes(client.file.size))
  console.log('EXO_CODE_EDITOR_READY', currentPath, content.version)
}

void main().catch((error: unknown) => {
  setNotice(`The code editor could not start: ${String(error)}`)
  console.error('EXO_CODE_EDITOR_ERROR', error)
})
