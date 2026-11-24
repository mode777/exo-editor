import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The kit's own side-effect element imports are tree-shaken out of the
// production bundle (verified with vscode-workbench 0.1.3 and Vite 8), which
// leaves every vscode-* tag unregistered. Register the peer package's tags the
// preset renders explicitly; check-dist-elements.mjs guards the bundle.
import '@vscode-elements/elements/dist/vscode-badge/index.js'
import '@vscode-elements/elements/dist/vscode-button/index.js'
import '@vscode-elements/elements/dist/vscode-context-menu/index.js'
import '@vscode-elements/elements/dist/vscode-icon/index.js'
import '@vscode-elements/elements/dist/vscode-tabs/index.js'
import '@vscode-elements/elements/dist/vscode-textfield/index.js'
import 'vscode-workbench/styles/tokens.css'
import 'vscode-workbench/styles/global.css'
import 'vscode-workbench/styles/workbench.css'
import './app.css'
import { App } from './App'
import { installResizePointerCapture } from './workbench/resize-capture'
import { configurePresetStore } from './workbench/tabs'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root container')
}

configurePresetStore()
installResizePointerCapture()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
