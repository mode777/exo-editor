import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { errorDetails, renderObservation } from './observation'

async function main(): Promise<void> {
  try {
    const connection = await connectBrowserPlugin()
    if (connection.mode !== 'register') {
      throw new Error('The controller entry must be mounted in register mode.')
    }
    connection.registration.register({
      glob: '**/*.template.txt',
      entry: 'editor.html',
      label: 'Exo Template',
    })
    const ack = await connection.registration.complete()
    renderObservation(
      { mode: 'register', phase: 'complete', accepted: ack.accepted, rejected: ack.rejected },
      `Exo template register ${ack.accepted.length} accepted`,
    )
    console.log('EXO_TEMPLATE_REGISTER', ack.accepted, ack.rejected)
  } catch (error) {
    const details = errorDetails(error)
    renderObservation(
      { mode: 'register', phase: 'error', error: details },
      'Exo template register error',
    )
    console.error('EXO_TEMPLATE_REGISTER_ERROR', details)
  }
}

void main()
