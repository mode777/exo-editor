/* Shared Exo view fixture. No build step and no dependencies. */
;(function () {
  const params = new URLSearchParams(location.hash.slice(1))
  const host = params.get('exo-host')
  const sessionId = params.get('exo-session')
  const mode = params.get('exo-mode')
  const observation = document.getElementById('observation')
  const state = {
    mode,
    origin: location.origin,
    phase: 'starting',
    view: null,
    capabilities: null,
    settings: {},
    subscriptions: [],
    events: [],
    results: [],
    errors: [],
    storage: 'unavailable',
    disposed: 'pending',
  }

  try {
    localStorage.setItem('exo-fixture-view', '1')
    localStorage.removeItem('exo-fixture-view')
    state.storage = 'available'
  } catch {
    state.storage = 'unavailable'
  }

  function render() {
    if (observation) observation.textContent = JSON.stringify(state)
    const kind = state.view ? state.view.kind : 'view'
    document.title = `Exo fixture ${kind} ${state.phase} events:${state.events.length} results:${state.results.length}`
  }

  function post(type, payload, id, replyTo) {
    const message = { exo: 1, type }
    if (id) message.id = id
    if (replyTo) message.replyTo = replyTo
    if (payload !== undefined) message.payload = payload
    parent.postMessage(message, host)
  }

  function subscribe(topic, id) {
    post('plugin/subscribe', { topic }, id)
  }

  function wire(buttonId, run) {
    const button = document.getElementById(buttonId)
    if (button) button.addEventListener('click', run)
  }

  wire('publish', () =>
    post(
      'plugin/publish',
      {
        topic: 'local/fixture',
        payload: { view: state.view && state.view.id, n: state.events.length + 1 },
      },
      `pub-${Date.now()}`,
    ),
  )
  wire('open-file', () => post('plugin/open-file', { path: '/notes.txt' }, `open-${Date.now()}`))
  wire('toggle-secondary', () =>
    post(
      'plugin/request-panel',
      { panel: 'fixture-inspector', action: 'toggle' },
      `panel-${Date.now()}`,
    ),
  )
  wire('hide-self', () =>
    post(
      'plugin/request-panel',
      {
        panel:
          state.view && state.view.id === 'fixture-inspector'
            ? 'fixture-inspector'
            : 'fixture-panel',
        action: 'hide',
      },
      `panel-${Date.now()}`,
    ),
  )
  wire('open-content', () =>
    post(
      'plugin/open-view',
      { viewId: 'fixture-tutorial', instanceKey: 'from-panel', payload: { from: 'panel' } },
      `view-${Date.now()}`,
    ),
  )
  wire('open-other', () =>
    post(
      'plugin/open-view',
      {
        pluginId: 'com.example.exo.fixture.other',
        viewId: 'other-tutorial',
        payload: { from: 'primary' },
      },
      `other-${Date.now()}`,
    ),
  )
  wire('subscribe-theme', () => subscribe('theme/changed', `theme-${Date.now()}`))

  window.addEventListener('message', (event) => {
    if (!host) return
    if (event.source !== parent) return
    if (event.origin !== host && event.origin !== 'null') return
    const data = event.data
    if (!data || data.exo !== 1) return

    if (data.type === 'shell/init') {
      if (state.phase !== 'starting') return
      state.phase = 'active'
      state.view = data.payload.view
      state.capabilities = data.payload.capabilities
      state.settings = data.payload.settings || {}
      render()
      if (state.capabilities && state.capabilities.localEvents)
        subscribe('local/fixture', 'sub-local')
      return
    }
    if (data.type === 'shell/subscribed') {
      state.subscriptions.push(data.payload)
      render()
      return
    }
    if (data.type === 'shell/event') {
      state.events.push(data.payload)
      render()
      return
    }
    if (data.type === 'shell/open-result' || data.type === 'shell/panel-result') {
      state.results.push({ type: data.type, payload: data.payload, replyTo: data.replyTo })
      render()
      return
    }
    if (data.type === 'shell/error') {
      state.errors.push({ payload: data.payload, replyTo: data.replyTo })
      render()
      return
    }
    if (data.type === 'shell/dispose') {
      state.disposed = data.payload && data.payload.reason
      state.phase = 'disposed'
      post('plugin/dispose-ack', {}, undefined, data.id)
      render()
    }
  })

  render()
  if (host && sessionId) {
    parent.postMessage(
      { exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId } },
      host,
    )
  }
})()
