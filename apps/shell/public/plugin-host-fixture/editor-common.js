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
    init: null,
    settings: {},
    subscriptions: [],
    events: [],
    reads: [],
    picks: [],
    pickReads: [],
    pendingPickRead: null,
    lists: [],
    listReads: [],
    pendingListRead: null,
    listStarted: false,
    local: { subscription: null, published: [], events: [] },
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
    document.title = `Exo fixture ${fixtureMode} ${state.phase} events:${state.events.length} picks:${state.picks.length} lists:${state.lists.length} local:${state.local.events.length}`
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

  function pickFiles() {
    if (fixtureMode !== 'picker') return
    post('plugin/request-files', { multiple: false }, undefined, `pick-${state.picks.length + 1}`)
  }

  const listProbes = [
    { id: 'list-root', path: '/' },
    { id: 'list-dir', path: '.' },
    { id: 'list-big', path: '/listing/big' },
    { id: 'list-file', path: null },
    { id: 'list-missing', path: '/missing-listing-dir' },
    { id: 'list-reserved', path: '/exo.json' },
  ]
  let listProbeIndex = 0

  function requestList(requestId, path, cursor) {
    post(
      'plugin/request-list',
      cursor === undefined ? { path } : { path, cursor },
      undefined,
      requestId,
    )
  }

  function startListing() {
    if (fixtureMode !== 'list' || state.listStarted) return
    state.listStarted = true
    nextListProbe()
  }

  function nextListProbe() {
    if (listProbeIndex >= listProbes.length) return
    const probe = listProbes[listProbeIndex]
    listProbeIndex += 1
    requestList(probe.id, probe.path === null ? state.file.path : probe.path)
  }

  function isListProbe(replyTo) {
    return (
      replyTo === 'list-root-2' ||
      replyTo === 'list-big-2' ||
      listProbes.some((probe) => probe.id === replyTo)
    )
  }

  function onListResult(replyTo, payload) {
    const entries = Array.isArray(payload.entries) ? payload.entries : []
    state.lists.push({
      id: replyTo,
      count: entries.length,
      first: entries[0] || null,
      entries: entries
        .slice(0, 5)
        .map((entry) =>
          entry.kind === 'file' ? `${entry.path} (file ${entry.size})` : `${entry.path} (dir)`,
        ),
      nextCursor: payload.nextCursor || null,
      reserved: entries.filter(
        (entry) =>
          entry.path === '/exo.json' ||
          entry.path === '/.exo' ||
          String(entry.path).startsWith('/.exo/'),
      ).length,
    })
    render()

    if (replyTo === 'list-root') {
      const file = entries.find(
        (entry) => entry.kind === 'file' && entry.path !== (state.file && state.file.path),
      )
      if (file) {
        state.pendingListRead = file.path
        post('plugin/request-file', { path: file.path, encoding: 'utf8' }, undefined, 'list-read')
      }
      if (payload.nextCursor) {
        requestList('list-root-2', '/', payload.nextCursor)
        return
      }
    }
    if (replyTo === 'list-big' && payload.nextCursor) {
      requestList('list-big-2', '/listing/big', payload.nextCursor)
      return
    }
    if (isListProbe(replyTo)) nextListProbe()
  }

  function onFileSelected(payload) {
    const paths = payload && Array.isArray(payload.paths) ? payload.paths : []
    state.picks.push({ paths })
    render()
    if (paths.length > 0) {
      state.pendingPickRead = paths[0]
      post(
        'plugin/request-file',
        { path: paths[0], encoding: 'utf8' },
        undefined,
        `pick-read-${state.picks.length}`,
      )
    }
  }

  function onInit(payload) {
    console.log('EXO_EDITOR init', payload && payload.file && payload.file.path)
    if (state.phase !== 'starting') return
    state.phase = 'active'
    state.file = payload.file
    state.permissions = payload.permissions
    state.capabilities = payload.capabilities
    state.limits = payload.limits
    state.settings = payload.settings || {}
    state.init = {
      theme: payload.theme,
      workspace: payload.workspace,
      permissions: payload.permissions,
      settings: payload.settings,
    }
    if (fixtureMode === 'events') subscribeAll()
    if (fixtureMode === 'local-events') subscribeLocal()
    if (fixtureMode === 'list') setTimeout(startListing, 300)
    render()
    // Delay the first read so a verifier can observe init without content.
    setTimeout(() => requestFile('read-1'), 500)
  }

  function subscribeAll() {
    for (const topic of [
      'theme/changed',
      'workspace/file-changed',
      'workspace/closed',
      'config/changed',
    ]) {
      post('plugin/subscribe', { topic }, undefined, `sub-${topic}`)
    }
  }

  function subscribeLocal() {
    post('plugin/subscribe', { topic: 'local/fixture' }, undefined, 'sub-local')
  }

  function publishLocal() {
    const n = state.local.published.length + 1
    post(
      'plugin/publish',
      {
        topic: 'local/fixture',
        payload: { path: state.file && state.file.path, n },
      },
      undefined,
      `pub-${n}`,
    )
  }

  function onSubscribed(payload) {
    state.subscriptions.push(payload)
    if (payload && payload.topic === 'local/fixture') state.local.subscription = payload
    console.log('EXO_EDITOR subscribed', payload && payload.topic, payload && payload.seq)
    render()
  }

  function onPublished(payload) {
    state.local.published.push({
      topic: payload && payload.topic,
      seq: payload && payload.seq,
    })
    console.log('EXO_EDITOR published', payload && payload.topic, payload && payload.seq)
    render()
  }

  function onEvent(payload) {
    state.events.push(payload)
    if (payload && typeof payload.topic === 'string' && payload.topic.startsWith('local/')) {
      state.local.events.push(payload)
    }
    if (
      payload &&
      payload.topic === 'config/changed' &&
      payload.payload &&
      payload.payload.values
    ) {
      state.settings = payload.payload.values
    }
    console.log('EXO_EDITOR event', payload && payload.topic, payload && payload.seq)
    render()
  }

  function onContent(payload) {
    console.log(
      'EXO_EDITOR content',
      payload && payload.path,
      typeof payload.text === 'string' ? payload.text.length : 'binary',
    )
    state.reads.push({
      path: payload.path,
      version: payload.version,
      length: typeof payload.text === 'string' ? payload.text.length : -1,
    })
    if (fixtureMode === 'picker' && state.pendingPickRead === payload.path) {
      state.pickReads.push({
        path: payload.path,
        version: payload.version,
        length: typeof payload.text === 'string' ? payload.text.length : -1,
      })
      state.pendingPickRead = null
      if (typeof payload.text === 'string') {
        state.buffer = `${state.buffer || ''}\n[fixture picked ${payload.path}]`
      }
      markDirty()
      return
    }
    if (fixtureMode === 'list' && state.pendingListRead === payload.path) {
      state.listReads.push({
        path: payload.path,
        version: payload.version,
        length: typeof payload.text === 'string' ? payload.text.length : -1,
      })
      state.pendingListRead = null
      render()
      return
    }
    if (typeof payload.text === 'string' && !state.dirty) {
      state.buffer = payload.text
    }
    render()
    if (fixtureMode === 'local-events') {
      // Stay clean on open so the local-event check does not prompt a save.
      return
    }
    if (fixtureMode === 'repeat' && state.reads.length === 1) {
      requestFile('read-2')
      return
    }
    if (fixtureMode === 'events') {
      // The events fixture stays clean on open and only simulates a local edit
      // after an external change, so save and return-to-clean are observable.
      if (state.external) markDirty()
      return
    }
    if (state.dirty) return
    markDirty()
  }

  function markDirty() {
    if (state.dirty) return
    state.dirty = true
    render()
    console.log('EXO_EDITOR dirty')
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
    console.log('EXO_EDITOR message', data.type)
    switch (data.type) {
      case 'shell/init':
        onInit(data.payload || {})
        break
      case 'shell/file-content':
        onContent(data.payload || {})
        break
      case 'shell/files-selected':
        onFileSelected(data.payload || {})
        break
      case 'shell/list-result':
        onListResult(data.replyTo, data.payload || {})
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
        if (data.payload && data.payload.kind !== 'deleted') {
          // Simulate a local edit so a later save exercises the conflict path.
          state.buffer = `${state.buffer || ''}\n[fixture local edit]`
          state.dirty = true
          post('plugin/dirty', { dirty: true })
          if (fixtureMode === 'events') {
            // Re-read so the following save uses the new base version.
            requestFile(`read-external-${state.reads.length + 1}`)
          }
        }
        render()
        break
      case 'shell/subscribed':
        onSubscribed(data.payload || {})
        break
      case 'shell/published':
        onPublished(data.payload || {})
        break
      case 'shell/event':
        onEvent(data.payload || {})
        break
      case 'shell/dispose':
        onDispose(data.payload)
        break
      case 'shell/error':
        state.errors.push(Object.assign({ replyTo: data.replyTo || null }, data.payload || {}))
        render()
        if (fixtureMode === 'list' && isListProbe(data.replyTo)) nextListProbe()
        break
    }
  })

  if (fixtureMode === 'picker') {
    const pick = document.getElementById('pick')
    if (pick) pick.addEventListener('click', pickFiles)
  }

  if (fixtureMode === 'local-events') {
    const publish = document.getElementById('publish')
    if (publish) publish.addEventListener('click', publishLocal)
  }

  render()
  post('plugin/ready', { protocolVersion: '1', sessionId }, undefined, undefined)
})()
