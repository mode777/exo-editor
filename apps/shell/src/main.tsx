import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'vscode-workbench/styles/tokens.css'
import 'vscode-workbench/styles/global.css'
import 'vscode-workbench/styles/workbench.css'
import './app.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root container')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
