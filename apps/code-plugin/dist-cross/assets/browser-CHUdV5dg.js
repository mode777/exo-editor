;(function () {
  let e = document.createElement(`link`).relList
  if (e && e.supports && e.supports(`modulepreload`)) return
  for (let e of document.querySelectorAll(`link[rel="modulepreload"]`)) n(e)
  new MutationObserver((e) => {
    for (let t of e)
      if (t.type === `childList`)
        for (let e of t.addedNodes) e.tagName === `LINK` && e.rel === `modulepreload` && n(e)
  }).observe(document, { childList: !0, subtree: !0 })
  function t(e) {
    let t = {}
    return (
      e.integrity && (t.integrity = e.integrity),
      e.referrerPolicy && (t.referrerPolicy = e.referrerPolicy),
      (t.credentials =
        e.crossOrigin === `use-credentials`
          ? `include`
          : e.crossOrigin === `anonymous`
            ? `omit`
            : `same-origin`),
      t
    )
  }
  function n(e) {
    if (e.ep) return
    e.ep = !0
    let n = t(e)
    fetch(e.href, n)
  }
})()
var e = class extends Error {
  code
  expected
  received
  constructor(e, t, n = {}) {
    ;(super(t, n.cause === void 0 ? void 0 : { cause: n.cause }),
      (this.name = `ExoProtocolError`),
      (this.code = e),
      (this.expected = n.expected),
      (this.received = n.received))
  }
}
function t(e) {
  return typeof e == `object` && !!e && !Array.isArray(e)
}
function n(e) {
  return !(
    !t(e) ||
    e.exo !== 1 ||
    typeof e.type != `string` ||
    e.type.length === 0 ||
    (e.id !== void 0 && (typeof e.id != `string` || e.id.length === 0 || e.id.length > 64)) ||
    (e.replyTo !== void 0 &&
      (typeof e.replyTo != `string` || e.replyTo.length === 0 || e.replyTo.length > 64))
  )
}
var r = class {
    transport
    handlers = new Map()
    anyHandlers = new Set()
    unsubscribe
    isClosed = !1
    constructor(e) {
      ;((this.transport = e), (this.unsubscribe = e.receive((e, t) => this.handle(e, t))))
    }
    get closed() {
      return this.isClosed
    }
    on(e, t) {
      let n = this.handlers.get(e)
      return (
        n || ((n = new Set()), this.handlers.set(e, n)),
        n.add(t),
        () => {
          n?.delete(t)
        }
      )
    }
    onAny(e) {
      return (
        this.anyHandlers.add(e),
        () => {
          this.anyHandlers.delete(e)
        }
      )
    }
    send(t, n, r = {}) {
      if (this.isClosed) throw new e(`closed`, `The plugin connection is closed.`)
      this.transport.post({
        exo: 1,
        type: t,
        ...(r.id === void 0 ? {} : { id: r.id }),
        ...(r.replyTo === void 0 ? {} : { replyTo: r.replyTo }),
        ...(n === void 0 ? {} : { payload: n }),
      })
    }
    close() {
      this.isClosed ||
        ((this.isClosed = !0), this.unsubscribe(), this.handlers.clear(), this.anyHandlers.clear())
    }
    handle(e, t) {
      if (
        this.isClosed ||
        t.source !== this.transport.parent ||
        t.origin !== this.transport.hostOrigin ||
        !n(e)
      )
        return
      let r = e,
        i = this.handlers.get(r.type)
      if (i) for (let e of [...i]) e(r)
      for (let e of [...this.anyHandlers]) e(r)
    }
  },
  i = [`dark`, `light`, `high-contrast`],
  a = [
    `unsupported-message`,
    `unsupported-version`,
    `protocol-violation`,
    `timeout`,
    `loading-failed`,
    `permission-denied`,
    `not-found`,
    `not-a-file`,
    `too-large`,
    `conflict`,
    `rate-limited`,
    `internal`,
  ]
function o(t, n) {
  throw new e(`protocol-violation`, `Invalid shell/init at ${t}: ${n}`)
}
function s(e, t, n) {
  let r = e[t]
  return (typeof r != `string` && o(`${n}.${t}`, `expected a string`), r)
}
function c(e, t, n) {
  let r = e[t]
  return (
    (typeof r == `number` && Number.isFinite(r)) || o(`${n}.${t}`, `expected a finite number`),
    r
  )
}
function l(e, t, n) {
  let r = e[t]
  return (typeof r != `boolean` && o(`${n}.${t}`, `expected a boolean`), r)
}
function u(e, n, r) {
  let i = e[n]
  return (t(i) || o(`${r}.${n}`, `expected an object`), i)
}
function d(e, t) {
  let n = u(e, `settings`, t),
    r = {}
  for (let [e, i] of Object.entries(n))
    (typeof i != `boolean` &&
      typeof i != `string` &&
      typeof i != `number` &&
      o(`${t}.settings.${e}`, `expected a boolean, string or number`),
      typeof i == `number` &&
        !Number.isFinite(i) &&
        o(`${t}.settings.${e}`, `expected a finite number`),
      (r[e] = i))
  return r
}
function f(e, t) {
  let n = u(e, `file`, t),
    r = {
      path: s(n, `path`, `${t}.file`),
      name: s(n, `name`, `${t}.file`),
      dir: s(n, `dir`, `${t}.file`),
      size: c(n, `size`, `${t}.file`),
      mtime: c(n, `mtime`, `${t}.file`),
      version: s(n, `version`, `${t}.file`),
    }
  return (n.languageHint !== void 0 && (r.languageHint = s(n, `languageHint`, `${t}.file`)), r)
}
function p(e, t) {
  let n = u(e, `capabilities`, t)
  return {
    read: l(n, `read`, `${t}.capabilities`),
    write: l(n, `write`, `${t}.capabilities`),
    requestFiles: l(n, `requestFiles`, `${t}.capabilities`),
  }
}
function m(e, t) {
  let n = u(e, `limits`, t)
  return {
    maxFileSize: c(n, `maxFileSize`, `${t}.limits`),
    maxRequestBytes: c(n, `maxRequestBytes`, `${t}.limits`),
  }
}
function h(n, r, a) {
  t(n) || o(`/`, `expected an object`)
  let c = n,
    l = s(c, `protocolVersion`, `/`),
    h = s(c, `mode`, `/`),
    g = s(c, `sessionId`, `/`)
  if (l !== a)
    throw new e(
      `unsupported-version`,
      `The shell reported protocol version ${l}; this SDK requested ${a}.`,
      { expected: a, received: l },
    )
  if (h !== r.mode)
    throw new e(
      `identity`,
      `The shell initialized a ${h} frame where a ${r.mode} frame was mounted.`,
    )
  if (g !== r.sessionId)
    throw new e(`identity`, `The shell session id does not match the frame session.`)
  let _ = u(c, `plugin`, `/`),
    v = u(c, `shell`, `/`),
    y = u(c, `workspace`, `/`),
    b = s(c, `theme`, `/`)
  i.includes(b) || o(`/theme`, `unknown theme`)
  let x = c.permissions
  ;(!Array.isArray(x) || x.some((e) => typeof e != `string`)) &&
    o(`/permissions`, `expected an array of strings`)
  let S = {
    protocolVersion: l,
    sessionId: g,
    plugin: { id: s(_, `id`, `/plugin`), version: s(_, `version`, `/plugin`) },
    shell: { version: s(v, `version`, `/shell`), origin: s(v, `origin`, `/shell`) },
    workspace: { name: s(y, `name`, `/workspace`) },
    theme: b,
    permissions: x,
    locale: s(c, `locale`, `/`),
    settings: d(c, `/`),
  }
  return h === `register`
    ? { ...S, mode: h }
    : (h !== `editor` && o(`/mode`, `expected register or editor`),
      { ...S, mode: h, file: f(c, `/`), capabilities: p(c, `/`), limits: m(c, `/`) })
}
function g(e) {
  if (!t(e)) return null
  let n = e.code
  return typeof n != `string` ||
    !a.includes(n) ||
    (e.message !== void 0 && typeof e.message != `string`)
    ? null
    : { code: n, ...(e.message === void 0 ? {} : { message: e.message }) }
}
var _ = [`not-declared`, `permission-denied`, `invalid-glob`, `invalid-contribution`]
function v(e) {
  if (
    !t(e) ||
    !Array.isArray(e.accepted) ||
    e.accepted.some((e) => typeof e != `string`) ||
    !Array.isArray(e.rejected)
  )
    return null
  let n = []
  for (let r of e.rejected) {
    if (
      !t(r) ||
      typeof r.index != `number` ||
      !Number.isInteger(r.index) ||
      r.index < 0 ||
      typeof r.reason != `string` ||
      !_.includes(r.reason) ||
      (r.message !== void 0 && typeof r.message != `string`)
    )
      return null
    n.push({
      index: r.index,
      reason: r.reason,
      ...(r.message === void 0 ? {} : { message: r.message }),
    })
  }
  return { accepted: e.accepted, rejected: n }
}
var y = class {
    gate
    init
    timeoutMs
    setTimeoutImpl
    clearTimeoutImpl
    completed = !1
    completing = !1
    constructor(t, n, r = {}) {
      if (n.mode !== `register`)
        throw new e(`identity`, `A registration client requires a register-mode initialization.`)
      ;((this.gate = t),
        (this.init = n),
        (this.timeoutMs = r.timeoutMs ?? 1e4),
        (this.setTimeoutImpl = r.setTimeoutImpl ?? setTimeout.bind(globalThis)),
        (this.clearTimeoutImpl = r.clearTimeoutImpl ?? clearTimeout.bind(globalThis)))
    }
    get initialization() {
      return this.init
    }
    get isComplete() {
      return this.completed
    }
    register(t) {
      if (this.completed || this.completing)
        throw new e(
          `protocol-violation`,
          `Registration is already complete; contributions cannot be added.`,
        )
      if (
        typeof t.glob != `string` ||
        t.glob.length === 0 ||
        typeof t.entry != `string` ||
        t.entry.length === 0 ||
        (t.label !== void 0 && typeof t.label != `string`)
      )
        throw new e(`protocol-violation`, `A registration needs a glob and an entry.`)
      let n = { glob: t.glob, entry: t.entry, ...(t.label === void 0 ? {} : { label: t.label }) }
      this.gate.send(`plugin/register`, { fileEditors: [n] })
    }
    complete() {
      return this.completed
        ? Promise.reject(new e(`protocol-violation`, `Registration has already been completed.`))
        : this.completing
          ? Promise.reject(
              new e(`protocol-violation`, `Registration completion is already in flight.`),
            )
          : ((this.completing = !0),
            new Promise((t, n) => {
              let r = null,
                i = !1,
                a = null,
                o = null,
                s = () => {
                  ;(r !== null && (this.clearTimeoutImpl(r), (r = null)), a?.(), o?.())
                },
                c = (e) => {
                  i || ((i = !0), s(), (this.completed = !0), (this.completing = !1), t(e))
                },
                l = (e) => {
                  i || ((i = !0), s(), (this.completing = !1), n(e))
                }
              ;((r = this.setTimeoutImpl(() => {
                l(
                  new e(
                    `timeout`,
                    `The shell did not acknowledge registration within ${this.timeoutMs} ms.`,
                  ),
                )
              }, this.timeoutMs)),
                (a = this.gate.on(`shell/register-ack`, (t) => {
                  let n = v(t.payload)
                  n
                    ? c(n)
                    : l(new e(`protocol-violation`, `The registration acknowledgement is invalid.`))
                })),
                (o = this.gate.on(`shell/error`, (t) => {
                  if (t.replyTo) return
                  let n = g(t.payload)
                  l(
                    n
                      ? new e(n.code, n.message ?? `Registration failed: ${n.code}.`)
                      : new e(`protocol-violation`, `The shell returned an invalid error.`),
                  )
                })),
                this.gate.send(`plugin/register-complete`, {}))
            }))
    }
  },
  b = [`created`, `changed`, `deleted`, `renamed`],
  x = [`closed`, `workspace-switch`, `plugin-removed`, `error`]
function S(t) {
  return t instanceof e ? t : new e(`internal`, `The plugin operation failed.`, { cause: t })
}
function C(e) {
  return !t(e) || typeof e.path != `string` || typeof e.version != `string`
    ? null
    : typeof e.text == `string`
      ? { path: e.path, version: e.version, text: e.text }
      : e.bytes instanceof ArrayBuffer
        ? { path: e.path, version: e.version, bytes: e.bytes }
        : null
}
function w(e) {
  return !t(e) || Object.keys(e).length !== 1
    ? !1
    : typeof e.text == `string` || e.bytes instanceof ArrayBuffer
}
function T(e) {
  if (!t(e)) return null
  if (e.ok === !0) return typeof e.version == `string` ? { ok: !0, version: e.version } : null
  if (e.ok !== !1) return null
  let n = g(e)
  return n
    ? { ok: !1, code: n.code, ...(n.message === void 0 ? {} : { message: n.message }) }
    : null
}
function E(e) {
  return !t(e) ||
    typeof e.path != `string` ||
    typeof e.kind != `string` ||
    !b.includes(e.kind) ||
    (e.version !== void 0 && typeof e.version != `string`)
    ? null
    : { path: e.path, kind: e.kind, ...(e.version === void 0 ? {} : { version: e.version }) }
}
function D(e) {
  return !t(e) || typeof e.topic != `string` || typeof e.seq != `number`
    ? null
    : { topic: e.topic, seq: e.seq, payload: e.payload }
}
var O = class {
  gate
  init
  pending = new Map()
  subscriptions = new Set()
  eventListeners = new Map()
  fileChangedListeners = new Set()
  disposeListeners = new Set()
  errorListeners = new Set()
  saveResultListeners = new Set()
  saveHandlers = []
  metadata
  liveSaveId = null
  nextRequestId = 0
  isClosed = !1
  disposed = !1
  constructor(t, n) {
    if (n.mode !== `editor`)
      throw new e(`identity`, `An editor client requires an editor-mode initialization.`)
    ;((this.gate = t),
      (this.init = n),
      (this.metadata = { ...n.file }),
      t.on(`shell/file-content`, (e) => this.handleContent(e.replyTo, e.payload)),
      t.on(`shell/error`, (e) => this.handleError(e.replyTo, e.payload)),
      t.on(`shell/request-save`, (e) => {
        this.handleSaveRequest(e.id)
      }),
      t.on(`shell/save-result`, (e) => this.handleSaveResult(e.replyTo, e.payload)),
      t.on(`shell/file-changed`, (e) => this.handleFileChanged(e.payload)),
      t.on(`shell/subscribed`, (e) => this.handleSubscribed(e.replyTo, e.payload)),
      t.on(`shell/event`, (e) => this.handleEvent(e.payload)),
      t.on(`shell/dispose`, (e) => this.handleDispose(e.payload)))
  }
  get initialization() {
    return this.init
  }
  get file() {
    return this.metadata
  }
  get capabilities() {
    return this.init.capabilities
  }
  get limits() {
    return this.init.limits
  }
  get settings() {
    return this.init.settings
  }
  get closed() {
    return this.isClosed
  }
  readFile(e, t = `utf8`) {
    let n = this.nextId()
    return this.request(n, `plugin/request-file`, { path: e, encoding: t })
  }
  setDirty(e) {
    this.isClosed || this.gate.send(`plugin/dirty`, { dirty: e })
  }
  onSaveRequest(e) {
    return (
      this.saveHandlers.push(e),
      () => {
        let t = this.saveHandlers.lastIndexOf(e)
        t >= 0 && this.saveHandlers.splice(t, 1)
      }
    )
  }
  onSaveResult(e) {
    return (
      this.saveResultListeners.add(e),
      () => {
        this.saveResultListeners.delete(e)
      }
    )
  }
  onFileChanged(e) {
    return (
      this.fileChangedListeners.add(e),
      () => {
        this.fileChangedListeners.delete(e)
      }
    )
  }
  onDispose(e) {
    return (
      this.disposeListeners.add(e),
      () => {
        this.disposeListeners.delete(e)
      }
    )
  }
  onError(e) {
    return (
      this.errorListeners.add(e),
      () => {
        this.errorListeners.delete(e)
      }
    )
  }
  subscribe(e) {
    let t = this.nextId()
    return this.request(t, `plugin/subscribe`, { topic: e }).then(
      (e) => (this.subscriptions.add(e.topic), e),
    )
  }
  unsubscribe(e) {
    this.isClosed ||
      (this.subscriptions.delete(e),
      this.eventListeners.delete(e),
      this.gate.send(`plugin/unsubscribe`, { topic: e }))
  }
  onEvent(e, t) {
    let n = this.eventListeners.get(e)
    n || ((n = new Set()), this.eventListeners.set(e, n))
    let r = t
    return (
      n.add(r),
      () => {
        this.eventListeners.get(e)?.delete(r)
      }
    )
  }
  close() {
    this.isClosed || ((this.isClosed = !0), this.rejectPending(), this.gate.close())
  }
  nextId() {
    return ((this.nextRequestId += 1), `exo-${this.nextRequestId}`)
  }
  request(t, n, r) {
    return this.isClosed
      ? Promise.reject(new e(`closed`, `The editor frame is closed.`))
      : this.pending.size >= 64
        ? Promise.reject(new e(`rate-limited`, `Too many in-flight plugin requests (maximum 64).`))
        : new Promise((e, i) => {
            this.pending.set(t, { resolve: (t) => e(t), reject: i })
            try {
              this.gate.send(n, r, { id: t })
            } catch (e) {
              ;(this.pending.delete(t), i(S(e)))
            }
          })
  }
  settle(e, t, n) {
    if (!e) return
    let r = this.pending.get(e)
    r && (this.pending.delete(e), t ? r.reject(t) : r.resolve(n))
  }
  rejectPending() {
    let t = [...this.pending.values()]
    this.pending.clear()
    for (let n of t) n.reject(new e(`closed`, `The editor frame was disposed.`))
  }
  handleContent(t, n) {
    let r = C(n)
    r
      ? this.settle(t, void 0, r)
      : this.settle(t, new e(`protocol-violation`, `The shell sent invalid file content.`))
  }
  handleError(t, n) {
    let r = g(n)
    if (t) {
      if (!r) {
        this.settle(t, new e(`protocol-violation`, `The shell sent an invalid error payload.`))
        return
      }
      this.settle(t, new e(r.code, r.message ?? `The shell returned ${r.code}.`))
    } else r && this.emitError(r)
  }
  emitError(e) {
    for (let t of [...this.errorListeners])
      try {
        t(e)
      } catch {}
  }
  async handleSaveRequest(e) {
    let t = this.saveHandlers.at(-1)
    if (!this.isClosed && e && t)
      try {
        let n = await t({ id: e })
        if (this.isClosed || !w(n)) return
        ;((this.liveSaveId = e), this.gate.send(`plugin/save-content`, n, { replyTo: e }))
      } catch {}
  }
  handleSaveResult(e, t) {
    let n = T(t)
    if (n && (this.liveSaveId === null || e === this.liveSaveId)) {
      ;((this.liveSaveId = null),
        n.ok && (this.metadata = { ...this.metadata, version: n.version }))
      for (let e of [...this.saveResultListeners])
        try {
          e(n)
        } catch {}
    }
  }
  handleFileChanged(e) {
    let t = E(e)
    if (t)
      for (let e of [...this.fileChangedListeners])
        try {
          e(t)
        } catch {}
  }
  handleSubscribed(n, r) {
    !t(r) || typeof r.topic != `string`
      ? this.settle(n, new e(`protocol-violation`, `The shell sent an invalid subscription reply.`))
      : r.code === `unsupported-topic`
        ? this.settle(n, new e(`unsupported-topic`, `The shell does not support ${r.topic}.`))
        : typeof r.seq == `number`
          ? this.settle(n, void 0, { topic: r.topic, seq: r.seq })
          : this.settle(
              n,
              new e(`protocol-violation`, `The shell sent an invalid subscription sequence.`),
            )
  }
  handleEvent(e) {
    let t = D(e)
    if (!t) return
    let n = this.eventListeners.get(t.topic)
    if (n)
      for (let e of [...n])
        try {
          e(t)
        } catch {}
  }
  handleDispose(e) {
    if (this.isClosed) return
    let n = t(e) && typeof e.reason == `string` && x.includes(e.reason) ? e.reason : `closed`
    if (!this.disposed) {
      this.disposed = !0
      try {
        this.gate.send(`plugin/dispose-ack`, {})
      } catch {}
    }
    ;((this.isClosed = !0), this.rejectPending())
    for (let e of [...this.disposeListeners])
      try {
        e(n)
      } catch {}
    this.gate.close()
  }
}
function k(e, t, n) {
  return t.mode === `register`
    ? {
        mode: `register`,
        init: t,
        registration: new y(e, t, {
          ...(n.setTimeoutImpl === void 0 ? {} : { setTimeoutImpl: n.setTimeoutImpl }),
          ...(n.clearTimeoutImpl === void 0 ? {} : { clearTimeoutImpl: n.clearTimeoutImpl }),
        }),
        close: () => e.close(),
      }
    : { mode: `editor`, init: t, editor: new O(e, t), close: () => e.close() }
}
function A(t) {
  let { transport: n } = t,
    i = t.protocolVersion ?? `1`,
    a = t.timeoutMs ?? 1e4,
    o = t.setTimeoutImpl ?? setTimeout.bind(globalThis),
    s = t.clearTimeoutImpl ?? clearTimeout.bind(globalThis)
  return new Promise((c, l) => {
    if (!n.hostOrigin) {
      l(new e(`bootstrap`, `The plugin has no host origin.`))
      return
    }
    if (!n.sessionId) {
      l(new e(`bootstrap`, `The plugin has no frame session id.`))
      return
    }
    if (n.mode !== `register` && n.mode !== `editor`) {
      l(new e(`bootstrap`, `The plugin has no valid frame mode.`))
      return
    }
    let u = new r(n),
      d = !1,
      f = null,
      p = null,
      m = null,
      _ = () => {
        ;(f !== null && (s(f), (f = null)), p?.(), m?.())
      },
      v = (e) => {
        d || ((d = !0), _(), u.close(), l(e))
      },
      y = (e) => {
        d || ((d = !0), _(), c(k(u, e, t)))
      }
    ;((f = o(() => {
      v(new e(`timeout`, `The shell did not initialize the ${n.mode} frame within ${a} ms.`))
    }, a)),
      (p = u.on(`shell/init`, (t) => {
        try {
          y(h(t.payload, n, i))
        } catch (t) {
          v(
            t instanceof e
              ? t
              : new e(`protocol-violation`, `The shell initialization is invalid.`, { cause: t }),
          )
        }
      })),
      (m = u.on(`shell/error`, (t) => {
        if (t.replyTo) return
        let n = g(t.payload)
        n
          ? n.code === `unsupported-version`
            ? v(
                new e(
                  `unsupported-version`,
                  `The shell rejected protocol version ${i}; this SDK speaks 1.`,
                  { expected: `1`, received: i },
                ),
              )
            : v(new e(n.code, n.message ?? `The shell rejected the plugin with ${n.code}.`))
          : v(new e(`protocol-violation`, `The shell sent an invalid error payload.`))
      })))
    try {
      u.send(`plugin/ready`, { protocolVersion: i, sessionId: n.sessionId })
    } catch (t) {
      v(
        t instanceof e
          ? t
          : new e(`internal`, `The plugin could not send plugin/ready.`, { cause: t }),
      )
    }
  })
}
function j(t) {
  if (!t) throw new e(`bootstrap`, `The plugin URL has no exo-host fragment parameter.`)
  let n
  try {
    n = new URL(t)
  } catch {
    throw new e(`bootstrap`, `The exo-host fragment parameter is not a URL.`)
  }
  if (n.protocol !== `https:` && n.protocol !== `http:`)
    throw new e(`bootstrap`, `The exo-host origin must be http or https.`)
  if (n.username || n.password || n.search || n.hash)
    throw new e(`bootstrap`, `The exo-host origin must not carry credentials or a query.`)
  if (n.pathname !== `` && n.pathname !== `/`)
    throw new e(`bootstrap`, `The exo-host value must be an origin, not a path.`)
  if (n.origin === `null`)
    throw new e(`bootstrap`, `The exo-host origin is not a valid web origin.`)
  return n.origin
}
function M(t) {
  let n = new URLSearchParams(t.startsWith(`#`) ? t.slice(1) : t),
    r = j(n.get(`exo-host`)),
    i = n.get(`exo-mode`)
  if (i !== `register` && i !== `editor`)
    throw new e(`bootstrap`, `The plugin URL needs exo-mode=register or exo-mode=editor.`)
  let a = n.get(`exo-session`)
  if (!a) throw new e(`bootstrap`, `The plugin URL has no exo-session fragment parameter.`)
  if (a.length > 256) throw new e(`bootstrap`, `The exo-session value is too long.`)
  return { hostOrigin: r, mode: i, sessionId: a }
}
function N(t = {}) {
  let n = t.window ?? window
  if (!n.parent || n.parent === n)
    throw new e(
      `bootstrap`,
      `The plugin must be embedded in the Exo shell; a top-level page has no shell parent.`,
    )
  let { hostOrigin: r, mode: i, sessionId: a } = M(n.location.hash),
    o = n.parent
  return {
    hostOrigin: r,
    mode: i,
    sessionId: a,
    parent: o,
    post(e) {
      o.postMessage(e, r)
    },
    receive(e) {
      let t = (t) => {
        e(t.data, { origin: t.origin, source: t.source })
      }
      return (n.addEventListener(`message`, t), () => n.removeEventListener(`message`, t))
    },
  }
}
function P(e = {}) {
  return A({ ...e, transport: N() })
}
export { P as t }
