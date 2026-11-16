import { ExoProtocolError } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { renderObservation } from './observation'

/**
 * Diagnostic entry: deliberately asks for protocol major 2. The shell answers
 * unsupported-version and never mounts an editor; this page surfaces both
 * versions instead of hanging.
 */
async function main(): Promise<void> {
  try {
    await connectBrowserPlugin({ protocolVersion: '2' })
    renderObservation(
      { phase: 'unexpected-success' },
      'Exo template protocol mismatch: unexpected success',
    )
  } catch (error) {
    const details =
      error instanceof ExoProtocolError
        ? {
            code: error.code,
            expected: error.expected ?? null,
            received: error.received ?? null,
            message: error.message,
          }
        : { code: 'internal', message: error instanceof Error ? error.message : String(error) }
    renderObservation({ phase: 'mismatch', ...details }, 'Exo template protocol mismatch')
    console.error('EXO_TEMPLATE_PROTOCOL_MISMATCH', details)
  }
}

void main()
