import { ExoProtocolError, PROTOCOL_VERSION } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { renderObservation } from './observation'

const REQUESTED_VERSION = '2'

/**
 * Diagnostic entry: deliberately asks for protocol major 2. The shell answers
 * unsupported-version and never mounts an editor; this page surfaces both
 * versions instead of hanging.
 *
 * The first log and render happen before the handshake so they survive the
 * shell unmounting the frame as soon as it rejects the major.
 */
function report(details: {
  code: string
  expected: string | null
  received: string | null
  message: string
}): void {
  renderObservation({ phase: 'mismatch', ...details }, 'Exo template protocol mismatch')
  console.error(`EXO_TEMPLATE_PROTOCOL_MISMATCH ${JSON.stringify(details)}`)
}

report({
  code: 'unsupported-version',
  expected: PROTOCOL_VERSION,
  received: REQUESTED_VERSION,
  message: `This diagnostic requests protocol ${REQUESTED_VERSION}; the SDK speaks ${PROTOCOL_VERSION}.`,
})

async function main(): Promise<void> {
  try {
    await connectBrowserPlugin({ protocolVersion: REQUESTED_VERSION })
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
        : {
            code: 'internal',
            expected: null,
            received: null,
            message: error instanceof Error ? error.message : String(error),
          }
    report(details)
  }
}

void main()
