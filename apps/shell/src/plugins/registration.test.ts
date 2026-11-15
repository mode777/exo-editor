import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeFrameTransport, type FakeFrame } from './frame-test-support'
import type { PluginManifest } from './manifest'
import {
  ACK_CLOSE_DELAY_MS,
  READY_TIMEOUT_MS,
  REGISTRATION_TIMEOUT_MS,
  RegistrationSession,
  type RegistrationOutcome,
  type RegistrationSessionOptions,
} from './registration'

const SHELL_ORIGIN = 'https://editor.example.com'

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    manifestUrl: 'https://plugins.example.com/monaco/exo-manifest.json',
    manifestOrigin: 'https://plugins.example.com',
    controllerUrl: 'https://plugins.example.com/monaco/plugin.html',
    pluginRoot: '/monaco/',
    id: 'com.example.monaco',
    name: 'Monaco Code Editor',
    version: '1.2.0',
    publisher: { name: 'Example Corp' },
    engines: { exo: '^0.1.0' },
    permissions: ['workspace:read'],
    fileEditors: [
      {
        glob: '**/*.ts',
        entry: 'editors/code.html',
        entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
        label: 'Code',
        priority: 10,
      },
      {
        glob: '**/*.js',
        entry: 'other.html',
        entryUrl: 'https://plugins.example.com/monaco/other.html',
        label: 'JS',
        priority: 0,
      },
    ],
    ...overrides,
  }
}

function start(overrides: Partial<RegistrationSessionOptions> = {}) {
  const transport = new FakeFrameTransport()
  const outcomes: RegistrationOutcome[] = []
  const options: RegistrationSessionOptions = {
    manifest: manifest(),
    transport,
    shellVersion: '0.1.0',
    shellOrigin: SHELL_ORIGIN,
    workspaceName: 'demo',
    theme: 'dark',
    locale: 'en',
    createSessionId: () => 'session-1',
    onOutcome: (outcome) => outcomes.push(outcome),
    ...overrides,
  }
  const session = new RegistrationSession(options)
  session.start()
  const frame = transport.frames[0] as FakeFrame
  return { transport, frame, session, outcomes, manifest: options.manifest }
}

function ready(
  context: ReturnType<typeof start>,
  options: {
    origin?: string
    sessionId?: string
    protocolVersion?: string
  } = {},
) {
  context.frame.emit(
    {
      exo: 1,
      type: 'plugin/ready',
      payload: {
        protocolVersion: options.protocolVersion ?? '1',
        sessionId: options.sessionId ?? 'session-1',
      },
    },
    options.origin ?? context.manifest.manifestOrigin,
  )
}

function register(
  context: ReturnType<typeof start>,
  fileEditors: unknown[],
  origin = context.manifest.manifestOrigin,
) {
  context.frame.emit({ exo: 1, type: 'plugin/register', payload: { fileEditors } }, origin)
}

function complete(context: ReturnType<typeof start>, origin = context.manifest.manifestOrigin) {
  context.frame.emit({ exo: 1, type: 'plugin/register-complete', payload: {} }, origin)
}

function postedType(frame: FakeFrame, type: string) {
  return frame.posted.find((entry) => (entry.message as { type?: string }).type === type)
    ?.message as { type: string; payload?: unknown; replyTo?: string } | undefined
}

afterEach(() => {
  vi.useRealTimers()
})

describe('registration session', () => {
  it('mounts the controller with the register fragment and cross-origin sandbox', () => {
    const context = start()
    expect(context.transport.frames).toHaveLength(1)
    expect(context.frame.options.sandbox).toBe('allow-scripts allow-same-origin')
    const url = new URL(context.frame.options.url)
    expect(url.pathname).toBe('/monaco/plugin.html')
    expect(url.hash).toContain('exo-host=https%3A%2F%2Feditor.example.com')
    expect(url.hash).toContain('exo-mode=register')
    expect(url.hash).toContain('exo-session=session-1')
  })

  it('sends init only after a valid ready, with no file block', () => {
    const context = start()
    ready(context)
    const init = postedType(context.frame, 'shell/init')
    expect(init?.payload).toMatchObject({
      protocolVersion: '1',
      mode: 'register',
      sessionId: 'session-1',
      plugin: { id: 'com.example.monaco', version: '1.2.0' },
      shell: { version: '0.1.0', origin: SHELL_ORIGIN },
      workspace: { name: 'demo' },
      theme: 'dark',
      permissions: ['workspace:read'],
      locale: 'en',
    })
    expect(init?.payload).not.toHaveProperty('file')
    expect(init?.payload).not.toHaveProperty('capabilities')
    expect(init?.payload).not.toHaveProperty('limits')
    expect(context.frame.posted[0].targetOrigin).toBe('https://plugins.example.com')
  })

  it('uses the stricter sandbox and wildcard target for an opaque same-origin frame', () => {
    const sameOrigin = manifest({
      manifestOrigin: SHELL_ORIGIN,
      manifestUrl: `${SHELL_ORIGIN}/plugin-host-fixture/exo-manifest.json`,
      controllerUrl: `${SHELL_ORIGIN}/plugin-host-fixture/plugin.html`,
      pluginRoot: '/plugin-host-fixture/',
    })
    const context = start({ manifest: sameOrigin })
    expect(context.frame.options.sandbox).toBe('allow-scripts')
    ready(context, { origin: 'null' })
    expect(postedType(context.frame, 'shell/init')?.payload).toMatchObject({ mode: 'register' })
    expect(context.frame.posted[0].targetOrigin).toBe('*')

    const wrongOrigin = start({ manifest: sameOrigin })
    ready(wrongOrigin, { origin: SHELL_ORIGIN })
    expect(postedType(wrongOrigin.frame, 'shell/init')).toBeUndefined()
  })

  it('fails a frame that never sends ready', () => {
    vi.useFakeTimers()
    const context = start()
    vi.advanceTimersByTime(READY_TIMEOUT_MS)
    expect(context.outcomes).toEqual([
      { kind: 'failed', code: 'timeout', phase: 'ready', message: undefined },
    ])
    expect(context.frame.closed).toBe(true)
  })

  it('fails a frame that never completes registration', () => {
    vi.useFakeTimers()
    const context = start()
    ready(context)
    vi.advanceTimersByTime(REGISTRATION_TIMEOUT_MS)
    expect(context.outcomes).toEqual([
      { kind: 'failed', code: 'timeout', phase: 'register', message: undefined },
    ])
    expect(context.frame.closed).toBe(true)
  })

  it('rejects the wrong protocol major before registration', () => {
    const context = start()
    ready(context, { protocolVersion: '2' })
    expect(context.outcomes[0]).toMatchObject({
      kind: 'failed',
      code: 'unsupported-version',
      phase: 'ready',
    })
    expect(postedType(context.frame, 'shell/error')?.payload).toMatchObject({
      code: 'unsupported-version',
    })
    expect(context.frame.closed).toBe(true)
  })

  it('requires the session echo before init', () => {
    const sameOrigin = manifest({
      manifestOrigin: SHELL_ORIGIN,
      manifestUrl: `${SHELL_ORIGIN}/plugin-host-fixture/exo-manifest.json`,
      controllerUrl: `${SHELL_ORIGIN}/plugin-host-fixture/plugin.html`,
      pluginRoot: '/plugin-host-fixture/',
    })
    const context = start({ manifest: sameOrigin })
    ready(context, { origin: 'null', sessionId: 'wrong' })
    expect(postedType(context.frame, 'shell/init')).toBeUndefined()
    expect(context.outcomes).toEqual([])

    ready(context, { origin: 'null', sessionId: 'wrong' })
    ready(context, { origin: 'null', sessionId: 'wrong' })
    expect(context.outcomes[0]).toMatchObject({
      kind: 'failed',
      code: 'protocol-violation',
      phase: 'ready',
    })
  })

  it('counts a second ready, a pre-ready register and a post-complete register', () => {
    const context = start()
    register(context, [])
    expect(postedType(context.frame, 'shell/error')?.payload).toMatchObject({
      code: 'protocol-violation',
    })
    ready(context)
    ready(context)
    expect(context.outcomes).toEqual([])
    register(context, [{ glob: '**/*.ts', entry: 'other.html', label: 'Code' }])
    complete(context)
    expect(context.outcomes[0]).toMatchObject({ kind: 'active' })

    register(context, [])
    register(context, [])
    register(context, [])
    expect(context.frame.closed).toBe(true)
  })

  it('activates declared sibling and descendant editors with the manifest label and priority', () => {
    const context = start()
    ready(context)
    register(context, [
      { glob: '**/*.ts', entry: 'other.html' },
      { glob: '**/*.js', entry: 'editors/other.js.html', label: 'JSX' },
    ])
    complete(context)
    const outcome = context.outcomes[0]
    expect(outcome.kind).toBe('active')
    if (outcome.kind !== 'active') return
    expect(outcome.editors).toEqual([
      {
        glob: '**/*.ts',
        entry: 'other.html',
        entryUrl: 'https://plugins.example.com/monaco/other.html',
        label: 'Code',
        priority: 10,
        registrationOrder: 0,
      },
      {
        glob: '**/*.js',
        entry: 'editors/other.js.html',
        entryUrl: 'https://plugins.example.com/monaco/editors/other.js.html',
        label: 'JSX',
        priority: 0,
        registrationOrder: 1,
      },
    ])
    expect(postedType(context.frame, 'shell/register-ack')?.payload).toMatchObject({
      accepted: ['**/*.ts', '**/*.js'],
      rejected: [],
    })
  })

  it('collects indexed rejections and keeps valid siblings', () => {
    const context = start()
    ready(context)
    register(context, [
      { glob: '**/*.md', entry: 'other.html' },
      { glob: '**/*.ts', entry: 'https://cdn.example.net/editor.html' },
      { glob: '**/*.js', entry: 'other.html', label: 'x'.repeat(41) },
      { glob: '!**/*.js', entry: 'other.html' },
      { glob: '**/*.ts', entry: 'other.html' },
    ])
    complete(context)
    const ack = postedType(context.frame, 'shell/register-ack')?.payload as {
      accepted: string[]
      rejected: Array<{ index: number; reason: string }>
    }
    expect(ack.accepted).toEqual(['**/*.ts'])
    expect(ack.rejected).toEqual([
      { index: 0, reason: 'not-declared' },
      { index: 1, reason: 'permission-denied' },
      { index: 2, reason: 'invalid-contribution' },
      { index: 3, reason: 'invalid-glob' },
    ])
    const outcome = context.outcomes[0]
    expect(outcome.kind).toBe('active')
    if (outcome.kind === 'active') {
      expect(outcome.editors).toHaveLength(1)
    }
  })

  it('rejects editor contributions from a plugin without read permission', () => {
    const context = start({
      manifest: manifest({ permissions: ['events:subscribe'] }),
    })
    ready(context)
    register(context, [{ glob: '**/*.ts', entry: 'other.html' }])
    complete(context)
    const ack = postedType(context.frame, 'shell/register-ack')?.payload as {
      accepted: string[]
      rejected: Array<{ index: number; reason: string }>
    }
    expect(ack.accepted).toEqual([])
    expect(ack.rejected).toEqual([{ index: 0, reason: 'permission-denied' }])
    const outcome = context.outcomes[0]
    expect(outcome.kind).toBe('active')
    if (outcome.kind === 'active') expect(outcome.editors).toEqual([])
  })

  it('treats workspace:write as read permission', () => {
    const context = start({
      manifest: manifest({ permissions: ['workspace:write'] }),
    })
    ready(context)
    register(context, [{ glob: '**/*.ts', entry: 'other.html' }])
    complete(context)
    const outcome = context.outcomes[0]
    expect(outcome.kind).toBe('active')
    if (outcome.kind === 'active') {
      expect(outcome.editors.map((editor) => editor.glob)).toEqual(['**/*.ts'])
    }
  })

  it('deduplicates identical glob and entry pairs', () => {
    const context = start()
    ready(context)
    register(context, [
      { glob: '**/*.ts', entry: 'other.html', label: 'One' },
      { glob: '**/*.ts', entry: 'other.html', label: 'Two' },
    ])
    complete(context)
    const outcome = context.outcomes[0]
    expect(outcome.kind).toBe('active')
    if (outcome.kind === 'active') {
      expect(outcome.editors).toHaveLength(1)
      expect(outcome.editors[0].label).toBe('One')
    }
  })

  it('does not activate anything without register-complete', () => {
    vi.useFakeTimers()
    const context = start()
    ready(context)
    register(context, [{ glob: '**/*.ts', entry: 'other.html' }])
    expect(context.outcomes).toEqual([])
    vi.advanceTimersByTime(REGISTRATION_TIMEOUT_MS)
    expect(context.outcomes[0]).toMatchObject({ kind: 'failed', code: 'timeout' })
  })

  it('removes the frame after the acknowledgement delay', () => {
    vi.useFakeTimers()
    const context = start()
    ready(context)
    register(context, [{ glob: '**/*.ts', entry: 'other.html' }])
    complete(context)
    expect(context.outcomes[0]).toMatchObject({ kind: 'active' })
    expect(context.frame.closed).toBe(false)
    vi.advanceTimersByTime(ACK_CLOSE_DELAY_MS)
    expect(context.frame.closed).toBe(true)
  })

  it('reports a load failure', () => {
    const context = start()
    context.frame.failLoad()
    expect(context.outcomes[0]).toMatchObject({
      kind: 'failed',
      code: 'loading-failed',
      phase: 'ready',
    })
    expect(context.frame.closed).toBe(true)
  })

  it('answers an unknown type with an id but does not change state', () => {
    const context = start()
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/unknown', id: 'request-1', payload: {} },
      context.manifest.manifestOrigin,
    )
    const error = postedType(context.frame, 'shell/error')
    expect(error?.replyTo).toBe('request-1')
    expect(error?.payload).toMatchObject({ code: 'unsupported-message' })
    expect(context.outcomes).toEqual([])
  })

  it('drops messages from a foreign source without a state change', () => {
    const context = start()
    context.frame.emit(
      { exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId: 'session-1' } },
      context.manifest.manifestOrigin,
      {} as Window,
    )
    expect(context.frame.posted).toEqual([])
    expect(context.outcomes).toEqual([])
  })

  it('drops a foreign origin and tears down after three violations', () => {
    const context = start()
    ready(context, { origin: 'https://evil.example.com' })
    expect(postedType(context.frame, 'shell/init')).toBeUndefined()
    ready(context, { origin: 'https://evil.example.com' })
    ready(context, { origin: 'https://evil.example.com' })
    expect(context.outcomes[0]).toMatchObject({
      kind: 'failed',
      code: 'protocol-violation',
      phase: 'ready',
    })
  })

  it('never treats handler-phase messages as registration input', () => {
    const context = start()
    ready(context)
    for (const type of [
      'plugin/request-file',
      'plugin/dirty',
      'plugin/save-content',
      'plugin/subscribe',
      'plugin/unsubscribe',
    ]) {
      context.frame.emit(
        { exo: 1, type, payload: { path: '/secret.txt' } },
        context.manifest.manifestOrigin,
      )
    }
    expect(context.outcomes[0]).toMatchObject({
      kind: 'failed',
      code: 'protocol-violation',
      phase: 'register',
    })
    expect(postedType(context.frame, 'shell/init')?.payload).not.toHaveProperty('file')
  })
})
