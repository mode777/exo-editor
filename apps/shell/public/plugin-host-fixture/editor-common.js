/* Shared Exo handler fixture. No build step and no dependencies. */
;(function () {
  const params = new URLSearchParams(location.hash.slice(1))
  const host = params.get('exo-host')
  const sessionId = params.get('exo-session')
  const mode = params.get('exo-mode')
  const fixtureMode = window.EXO_FIXTURE_MODE || 'default'
  const observation = document.getElementById('observation')

  const state = {
    fixtureMode,
    mode,
    origin: location.origin,
    phase: 'starting',
    file: null,
    reads: [],
    dirty: false,
    disposed: 'pending',
    external: null,
    saveCount: 0,
    saveResult: null,
    errors: [],
  }

  function render() {
    state.origin = location.origin
    observation.textContent = JSON.stringify(state)
    document.title = `Exo fixture ${fixtureMode} ${state.phase}`
  }

  function post(type, payload, replyTo, id) {
    const message = { exo: 1, type }
    if (id) message.id = id
    if (replyTo) message.replyTo = replyTo
    if (payload !== undefined) message.payload = payload
    parent.postMessage(message, host)
  }

  function requestFile(requestId) {
    post('plugin/request-file', { path: state.file.path, encoding: 'utf8' }, undefined, requestId)
  }

  function onInit(payload) {
    if (state.phase !== 'starting') return
    state.phase = 'active'
    state.file = payload.file
    state.permissions = payload.permissions
    state.capabilities = payload.capabilities
    state.limits = payload.limits
    render()
    requestFile('read-1')
  }

  function onContent(payload) {
    state.reads.push({
      path: payload.path,
      version: payload.version,
      length: typeof payload.text === 'string' ? payload.text.length : -1,
    })
    if (typeof payload.text === 'string') {
      state.buffer = payload.text
    }
    render()
    if (fixtureMode === 'repeat' && state.reads.length === 1) {
      requestFile('read-2')
      return
    }
    if (state.dirty) return
    state.dirty = true
    render()
    post('plugin/dirty', { dirty: true })
  }

  function onSave(requestId) {
    if (typeof state.buffer !== 'string') {
      post('shell/save-content', { text: '' }, requestId)
      return
    }
    state.saveCount += 1
    const marker =
      fixtureMode === 'append'
        ? `\n[fixture append ${state.saveCount}]`
        : `\n[fixture save ${state.saveCount}]`
    state.buffer += marker
    post('plugin/save-content', { text: state.buffer }, requestId)
    render()
  }

  function onSaveResult(payload) {
    state.saveResult = payload
    if (payload && payload.ok) {
      state.dirty = false
      post('plugin/dirty', { dirty: false })
    }
    render()
  }

  function onDispose(payload) {
    if (fixtureMode === 'neverack') {
      state.disposed = 'ignored'
      render()
      return
    }
    state.disposed = payload && payload.reason ? payload.reason : 'closed'
    state.phase = 'disposed'
    render()
    post('plugin/dispose-ack', {})
  }

  window.addEventListener('message', (event) => {
    if (!host) return
    if (event.source !== parent) return
    // A same-origin sandboxed frame reports "null"; the cross-origin fixture
    // reports the shell origin it was told to post to.
    if (event.origin !== host && event.origin !== 'null') return
    const data = event.data
    if (!data || data.exo !== 1) return
    switch (data.type) {
      case 'shell/init':
        onInit(data.payload || {})
        break
      case 'shell/file-content':
        onContent(data.payload || {})
        break
      case 'shell/request-save':
        onSave(data.id)
        break
      case 'shell/save-result':
        onSaveResult(data.payload)
        break
      case 'shell/file-changed':
        state.external = data.payload
        if (data.payload && data.payload.kind === 'renamed' && state.file) {
          state.file = Object.assign({}, state.file, { path: data.payload.path })
        }
        render()
        break
      case 'shell/dispose':
        onDispose(data.payload)
        break
      case 'shell/error':
        state.errors.push(data.payload)
        render()
        break
    }
  })

  render()
  post('plugin/ready', { protocolVersion: '1', sessionId }, undefined, undefined)
})()
