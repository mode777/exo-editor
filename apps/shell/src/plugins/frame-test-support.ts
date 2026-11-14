import type { FrameHandle, FrameOpenOptions, FrameTransport, PluginMessage } from './frame'

export interface PostedMessage {
  message: unknown
  targetOrigin: string
}

export interface FakeFrame extends FrameHandle {
  readonly options: FrameOpenOptions
  readonly window: Window
  readonly posted: PostedMessage[]
  closed: boolean
  close(): void
  emit(data: unknown, origin: string, source?: Window | null): void
  failLoad(): void
}

/**
 * Test-only transport. It records the requested URL and sandbox and lets a test
 * deliver a message with an arbitrary source and origin, which is how the host's
 * origin/source checks are exercised.
 */
export class FakeFrameTransport implements FrameTransport {
  readonly frames: FakeFrame[] = []
  disposed = false

  open(options: FrameOpenOptions): FakeFrame {
    const posted: PostedMessage[] = []
    const window = {
      postMessage: (message: unknown, targetOrigin: string) => {
        posted.push({ message, targetOrigin })
      },
    } as unknown as Window
    const frame: FakeFrame = {
      options,
      window,
      posted,
      closed: false,
      close: () => {
        frame.closed = true
      },
      emit: (data, origin, source = window) => {
        const message: PluginMessage = { data, origin, source }
        options.onMessage(message)
      },
      failLoad: () => options.onLoadError(),
    }
    this.frames.push(frame)
    return frame
  }

  dispose(): void {
    this.disposed = true
  }
}
