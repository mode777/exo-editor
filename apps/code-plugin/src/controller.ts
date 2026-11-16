import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'

const EDITORS = [
  { glob: '**/*.{ts,tsx}', entry: 'editor.html', label: 'TypeScript' },
  { glob: '**/*.{js,jsx}', entry: 'editor.html', label: 'JavaScript' },
  { glob: '**/*.json', entry: 'editor.html', label: 'JSON' },
  { glob: '**/*.md', entry: 'editor.html', label: 'Markdown' },
] as const

async function main(): Promise<void> {
  try {
    const connection = await connectBrowserPlugin()
    if (connection.mode !== 'register') {
      throw new Error('The controller entry must be mounted in register mode.')
    }
    for (const editor of EDITORS) connection.registration.register(editor)
    const ack = await connection.registration.complete()
    console.log('EXO_CODE_REGISTER', ack.accepted, ack.rejected)
  } catch (error) {
    console.error('EXO_CODE_REGISTER_ERROR', error)
  }
}

void main()
