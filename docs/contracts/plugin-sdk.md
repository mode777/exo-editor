# Plugin SDK Contract (v1)

Status: introduced by the OpenSpec change `plugin-sdk-template`. Normative
requirements are mirrored in `openspec/specs/plugin-sdk/spec.md`. The wire
messages themselves are defined by [`plugin-protocol.md`](./plugin-protocol.md)
and [`events.md`](./events.md); this document defines the plugin-side client
behaviour and the compatibility policy.

## 1. Purpose

Every plugin has to implement the same security-relevant client logic: parse the
frame fragment, verify the sender, perform the handshake, correlate requests,
register contributions, read and save, subscribe to topics and dispose. The SDK
provides that client once, with types, and the starter template proves it is
enough to ship a plugin.

## 2. Package and versions

| Artifact                                            | Version | Packaging                                        |
| --------------------------------------------------- | ------- | ------------------------------------------------ |
| `packages/plugin-sdk` (`@exo/plugin-sdk`)           | `1.9.0` | Private workspace package; no runtime dependency |
| `packages/plugin-template` (`@exo/plugin-template`) | `0.1.0` | Private workspace package; built static assets   |

- The SDK MAJOR equals the protocol major it speaks. `PROTOCOL_VERSION` and
  `SDK_VERSION` are exported constants; a plugin must not hard-code the protocol
  number. `1.1.0` adds the additive `requestSave()` helper, `1.2.0` adds the
  additive `requestFiles()` helper, `1.3.0` adds the additive
  `listDirectory()` helper, `1.4.0` adds the additive local-event helpers and
  `1.5.0` adds the view client, panel/content-view registration and the
  `openFile()`, `openView()` and `requestPanel()` helpers, `1.6.0` adds
  command registration, `onCommand()` and the command support bit, `1.7.0`
  adds `requestNewFile()`, `registerNewFile()` and the creation/template support
  bits, `1.8.0` adds the DOM-only theme helper and the optional token
  stylesheet, and `1.9.0` exposes the active content view from `shell/init` and
  the `view/active` event topic, all without changing the protocol major.
- The packages are not published in v1 (D12). Consumers in this repository use
  the workspace copy. A future publication adds a built `dist` and does not
  change the message protocol.
- The SDK core is DOM-free: importing `@exo/plugin-sdk` does not read `window`,
  `document`, `location` or `parent`. `@exo/plugin-sdk/browser` and
  `@exo/plugin-sdk/theme` are the explicit DOM-only entry points; a browser
  plugin imports the ones it uses.

## 3. Browser bootstrap

The browser adapter reads the fragment the shell puts on the frame URL:

```text
#exo-host=https%3A%2F%2Feditor.example.com&exo-mode=editor&exo-session=<opaque-id>
```

- `exo-host` must be an absolute `http` or `https` origin with no path, query,
  credentials or fragment. The adapter returns `url.origin`.
- `exo-mode` must be `register`, `editor` or `view`.
- `exo-session` must be present and at most 256 characters.
- A top-level page (`window.parent === window`) is refused: it is not embedded
  in the shell and has nothing to talk to.
- A missing or invalid value raises `ExoProtocolError` with code `bootstrap`
  before any message is sent.

The adapter listens for `message` on the frame window and posts to
`window.parent` with the exact `exo-host` origin. It never uses `*`, including
from a same-origin frame whose sandbox gives it an opaque origin: the receiver
(the shell) still has a nameable origin.

## 4. Message gate

Every incoming message passes one gate before a client sees it:

1. `event.source` must be the parent window supplied by the transport.
2. `event.origin` must equal `exo-host` exactly. The shell is the sender in both
   sandbox modes, so accepting `"null"` as a sender origin would only weaken the
   check.
3. The envelope must be a plain object with `exo: 1`, a non-empty `type`, and
   optional `id`/`replyTo` strings of 1-64 characters.
4. `shell/init` must additionally satisfy the mode and session checks in
   section 5.

Messages that fail any check are dropped without throwing and without resolving
a pending request. A spoofed `shell/init` therefore leaves the handshake pending
until its timeout.

## 5. Handshake

`connectPlugin({ transport })` (or `connectBrowserPlugin()` in a browser):

1. Sends `plugin/ready` once with
   `{ protocolVersion, sessionId }`.
2. Waits up to 10 seconds for `shell/init`.
3. Validates `protocolVersion`, `mode`, `sessionId` and the shape of the typed
   payload. `mode` and `sessionId` must echo the transport; the protocol major
   must equal the requested major.
4. Returns a discriminated connection:

```ts
type PluginConnection =
  | { mode: 'register'; init: RegistrationInit; registration: RegistrationClient; close(): void }
  | { mode: 'editor'; init: EditorInit; editor: EditorClient; close(): void }
  | { mode: 'view'; init: ViewInit; view: ViewClient; close(): void }
```

A protocol mismatch raises `ExoProtocolError` with code `unsupported-version`,
`expected` (the SDK's supported major) and `received` (the version the shell
reported, or the version the shell rejected). No registration or file message is
sent after the failure.

## 6. Registration client

`RegistrationClient` is only available on a register-mode connection.

```text
register({ glob, entry, label? })   -> one plugin/register
registerPanel(id)                   -> one plugin/register with { panels: [id] }
registerContentView(id)             -> one plugin/register with { contentViews: [id] }
registerCommand(id)                 -> one plugin/register with { commands: [id] }
registerNewFile(id)                 -> one plugin/register with { newFiles: [id] }
complete()                          -> one plugin/register-complete, then shell/register-ack
```

- `complete()` resolves with
  `{ accepted: string[], acceptedPanels: string[], acceptedContentViews: string[], acceptedCommands: string[], acceptedNewFiles: string[], rejected: RejectedContribution[] }`.
  Each rejection carries its index, stable reason, optional `kind` and optional
  message. An older shell's acknowledgement omits the view, command and template
  arrays; the SDK reports them as empty rather than failing the editor
  registrations.
- `registerNewFile(id)` rejects locally with `unsupported-message` when the
  registration init omits `capabilities.newFiles`.
- A second `complete()` rejects locally as `protocol-violation` and sends no
  second message.
- A registration call after completion rejects locally.
- The shell remains authoritative: the SDK does not validate the manifest, glob
  declarations, page containment or labels. It only enforces the message shape
  and the mode.

## 7. Editor client

`EditorClient` is only available on an editor-mode connection.

```ts
editor.file // FileMetadata from shell/init, no content
editor.capabilities // read, write, requestFiles, filePicker, createFile, directoryListing,
                   // localEvents, openFile, openView, requestPanel, commands
editor.limits // maxFileSize, maxRequestBytes
editor.settings // resolved shell settings
editor.readFile(path, 'utf8' | 'binary')
editor.requestFiles({ multiple?, directory? })
editor.requestNewFile({ text | bytes, suggestedName?, directory? })
editor.listDirectory(path, { cursor? })
editor.setDirty(dirty)
editor.requestSave()
editor.onSaveRequest(handler)
editor.onSaveResult(listener)
editor.onFileChanged(listener)
editor.onCommand(handler)
editor.onDispose(listener)
editor.onError(listener)
editor.subscribe(topic)
editor.unsubscribe(topic)
editor.onEvent(topic, listener)
editor.publishLocal(topic, payload)
editor.subscribeLocal(topic)
editor.onLocalEvent(topic, listener)
```

- Reads send `plugin/request-file` with a per-frame monotonic id and resolve from
  the matching `shell/file-content`. A matching `shell/error` rejects that read
  with its stable code and leaves other requests pending.
- `requestFiles()` sends one `plugin/request-files` and resolves with a
  `string[]` of selected `/`-rooted paths; `[]` means the user cancelled. It
  rejects locally with `unsupported-message` when the shell omits
  `capabilities.filePicker`, with `permission-denied` when `requestFiles` is
  false, and with `rate-limited` when the client already has one pending picker.
  The shell returns no content, so a selected path is read with `readFile()`.
  Manual path entry remains the fallback on a shell that predates the message.
- `requestNewFile({ text | bytes, suggestedName?, directory? })` sends one
  `plugin/request-new-file` with exactly one content field and resolves with
  `{ path, version }`, or `null` when the user cancels. It rejects locally with
  `unsupported-message` when the shell omits `capabilities.createFile`, with
  `permission-denied` when the manifest lacks `workspace:write`, with
  `too-large` naming the actual size and the 8 MiB limit, and with
  `rate-limited` when the client already has one pending request. A shell
  `already-exists` rejects with that code so the plugin can ask for another name.
  A runtime-created file is not opened automatically; call `openFile()` if that
  is appropriate.
- `listDirectory(path, { cursor? })` sends one `plugin/request-list` with a fresh
  id and resolves with `{ entries, nextCursor? }` from the matching
  `shell/list-result`. It rejects locally with `unsupported-message` when the
  shell omits `capabilities.directoryListing`, with `permission-denied` when the
  manifest lacks `workspace:list`, and with the shell's stable code for a
  `not-a-directory`, `not-found`, `rate-limited`, `timeout` or other correlated
  error. A malformed page or entry rejects with `protocol-violation` and exposes
  no partial entries. The cursor is opaque: the SDK passes it through unchanged
  and does not define its format. `readFile()` and the user picker remain the
  fallback when listing is unsupported.
- The SDK allows at most 64 in-flight requests per frame. The next request
  rejects locally with `rate-limited`.
- `setDirty` sends one `plugin/dirty` with the boolean value. The SDK never
  infers dirty state from a DOM event.
- `requestSave()` sends one id-less `plugin/request-save` and returns immediately.
  It starts no pending request; the normal `onSaveResult` listener is the
  outcome. The plugin checks dirty and write capability first, and keeps the Shell
  Save action as the fallback when an older shell ignores the notification.
- A `shell/request-save` invokes the most recently registered save handler. The
  handler returns `{ text }` or `{ bytes }`; the SDK sends `plugin/save-content`
  with the request id as `replyTo` and reports the matching `shell/save-result`
  to `onSaveResult`. On success `editor.file.version` advances to the returned
  version.
- A missing save handler, a throwing handler or a rejected handler sends
  nothing. The protocol defines no save-cancel message, so the shell's
  five-second timeout is the outcome and the document stays dirty.
- `shell/file-changed` is delivered to `onFileChanged` without changing dirty
  state. The plugin decides whether to reload.
- `shell/dispose` rejects every pending request, sends `plugin/dispose-ack` once,
  marks the client closed and ignores later messages. Disposal is idempotent.
- `shell/error` with no `replyTo` is delivered to `onError`; it does not close the
  connection. A throwing listener is contained.

## 7.1 View client

`ViewClient` is only available on a view-mode connection. It shares the read,
new-file, listing, picker, event, navigation and disposal API with `EditorClient`
and exposes no save or dirty methods.

```ts
view.view // ViewInitData from shell/init: kind, id, title, instanceId, location?, payload?, openedBy?
view.activeContentView // { pluginId, viewId, instanceId, instanceKey } | null
view.capabilities // same shape as the editor capabilities
view.limits // maxFileSize, maxRequestBytes
view.settings // resolved shell settings
view.readFile(path, 'utf8' | 'binary')
view.requestFiles({ multiple?, directory? })
view.requestNewFile({ text | bytes, suggestedName?, directory? })
view.listDirectory(path, { cursor? })
view.openFile(path)
view.openView({ pluginId?, viewId, instanceKey?, payload? })
view.requestPanel(panel, 'show' | 'hide' | 'toggle')
view.onCommand(handler)
view.onDispose(listener)
view.onError(listener)
view.subscribe(topic)
view.unsubscribe(topic)
view.onEvent(topic, listener)
view.publishLocal(topic, payload)
view.subscribeLocal(topic)
view.onLocalEvent(topic, listener)
```

- The view block is immutable for the connection lifetime; the SDK does not
  fetch, rewrite or persist it. A content-view payload is exposed as data and is
  never interpreted.
- `readFile()` with a relative path is rejected locally with `permission-denied`;
  a view has no document to resolve against. Use a `/`-rooted path.
- `shell/dispose` rejects outstanding requests, sends `plugin/dispose-ack` once
  and ignores later messages, exactly as for an editor.
- An editor and a view frame from the same plugin receive the same support bits
  and permission-derived capabilities.

## 7.2 Navigation and panel helpers

Both clients expose the same helpers:

```ts
openFile(path)                                  -> { ok: true }
openView({ pluginId?, viewId, instanceKey?, payload? }) -> { ok: true }
requestPanel(panel, action)                     -> { panel, open }
```

- Each call sends one correlated `plugin/open-file`, `plugin/open-view` or
  `plugin/request-panel` and resolves from `shell/open-result` or
  `shell/panel-result`. A shell error rejects with its stable code.
- `openFile()` rejects locally with `unsupported-message` when
  `capabilities.openFile` is false, with `permission-denied` when the manifest
  lacks `workspace:read` or a view names a relative path, and sends nothing.
- `openView()` rejects locally for an invalid view/plugin/instance shape, for a
  payload over 64 KiB with `too-large` and a message naming the limit, and for a
  missing `capabilities.openView` support bit. Omitting `pluginId` targets the
  caller's own plugin.
- `requestPanel()` rejects locally for an invalid panel id or action and for a
  missing `capabilities.requestPanel` support bit. The shell accepts only the
  caller's own registered panels.
- An older shell omits the support bits; the helpers reject locally and send no
  message, so a plugin can keep its previous UI.

## 7.3 Command handler

Both clients expose one handler for shell-delivered commands:

```ts
onCommand(handler) -> unsubscribe
handler({ command, args? }) -> void | { ok: true } | { ok: false, message? }
```

- Each incoming `shell/command` is answered automatically with exactly one
  `plugin/command-result` whose `replyTo` is the invocation id. A resolved
  promise or `void` return is success; a thrown error or `{ ok: false }` sends a
  bounded failure message of at most 200 characters.
- `args` is `{ path, kind }` only for an explorer invocation. The handler receives
  it unchanged and never receives file content.
- Up to ten commands that arrive before a handler is attached are queued and
  dispatched when it is attached; the eleventh is answered with a failure so the
  shell's timeout cannot hang. Messages after disposal are ignored.
- `supportsCommands` reports `capabilities.commands`, which is false when an
  older shell omits the bit. The SDK sends no command-related message on its own;
  a plugin can keep its previous UI when the bit is false.

## 7.4 Theme helper and stylesheet

`@exo/plugin-sdk/theme` is DOM-only and is not part of the DOM-free core. It
exposes two helpers and the option types:

```ts
applyTheme(theme, { document? })            -> void
followTheme(client, { document?, onTheme? }) -> Promise<() => void>
```

- `applyTheme` writes the exact `ThemeName` to `data-theme` on the target
  document root. It writes no inline style.
- `followTheme` applies `client.initialization.theme` immediately, calls
  `onTheme` with it, subscribes to `theme/changed` when the manifest has
  `events:subscribe`, applies each later value and calls `onTheme` with it.
  Without the permission it sends no message and resolves with a no-op cleanup.
  A failed subscription rejects after the initial theme has been applied.
- The returned cleanup removes the helper's listener. It does not unsubscribe
  the topic, because other listeners in the frame may share it.
- Neither helper adds a protocol message, permission, manifest field or consent
  input, and neither persists a theme.

`@exo/plugin-sdk/theme.css` is an optional semantic token sheet for dark, light
and high-contrast. Importing it loads no JavaScript. The `exports` map includes
`./theme` and `./theme.css`, and `sideEffects` preserves the CSS import in a
production build. Token names, values and usage rules are in
[`plugin-styling.md`](./plugin-styling.md).

## 8. Event client

- `subscribe(topic)` sends `plugin/subscribe` and resolves `{ topic, seq }` from
  `shell/subscribed`. `unsupported-topic` and `permission-denied` reject the
  promise with that code.
- `unsubscribe(topic)` sends `plugin/unsubscribe`, removes the local listener and
  returns immediately; the protocol defines no acknowledgement. It accepts both
  shell and local topics.
- `onEvent(topic, listener)` receives `{ topic, seq, payload }` for that topic.
  A throwing listener is contained and later events still arrive.
- Topic names and payloads are the v1 catalog in [`events.md`](./events.md).
- `publishLocal(topic, payload)` sends one correlated `plugin/publish` and
  resolves `{ topic, seq }` from `shell/published`. It rejects locally with
  `unsupported-message` when `capabilities.localEvents` is absent or false, with
  `permission-denied` when the manifest lacks `events:subscribe` or the caller
  names a shell topic, with `unsupported-topic` for a malformed `local/<name>`,
  and with `too-large` for a payload over 1 MiB. A failed preflight sends no
  message. The shell acknowledgement means the event was accepted, not handled.
- `subscribeLocal(topic)` sends one `plugin/subscribe` and resolves with the
  current local sequence; no history is replayed. It applies the same support,
  permission and topic preflights.
- `onLocalEvent(topic, listener)` receives `{ topic, seq, from, payload }` for a
  subscribed local topic. `from` is the publishing frame's opaque session id;
  the SDK does not interpret the payload. `shell/dispose` rejects pending local
  calls with `closed`.
- A local publisher that also subscribes receives its own event and can ignore
  it by comparing `from` with its own session id.

## 9. Compatibility and deprecation policy

| Change                                | SDK version | Protocol version                    | Manifest schema                              |
| ------------------------------------- | ----------- | ----------------------------------- | -------------------------------------------- |
| Bug fix, no API change                | PATCH       | unchanged                           | unchanged                                    |
| New helper or additive optional field | MINOR       | unchanged (additive within a major) | unchanged                                    |
| Remove or reinterpret a wire field    | MAJOR       | new major                           | unchanged unless the manifest itself changes |
| Manifest field change                 | independent | independent                         | new `schemaVersion`                          |

- The SDK MAJOR and protocol MAJOR advance together. The shell accepts exactly
  one protocol major per release, as defined in
  [`plugin-protocol.md`](./plugin-protocol.md#8-versioning).
- Plugin-local event helpers are an additive minor (`1.4.0`): they do not change
  an existing method or the meaning of a shell topic. A shell that predates them
  omits `capabilities.localEvents`; the SDK treats absence as false and rejects
  local calls locally.
- Command registration and `onCommand()` are an additive minor (`1.6.0`). A shell
  that predates them omits `capabilities.commands`; the SDK treats absence as
  false and never fabricates a command result.
- New-file creation and template registration are an additive minor (`1.7.0`). A
  shell that predates them omits `capabilities.createFile` and
  `capabilities.newFiles`; the SDK treats absence as false and rejects
  `requestNewFile()`/`registerNewFile()` locally with `unsupported-message`.
- The theme helper and token stylesheet are an additive minor (`1.8.0`). They are
  plugin-page utilities, not wire features: an older shell still provides
  `shell/init.theme` and, with the permission, `theme/changed`, and a plugin that
  does not import them keeps its current behavior.
- `activeContentView` and `view/active` are an additive minor (`1.9.0`). An older
  shell omits the init field and rejects the topic; the SDK reports `null` and
  leaves event subscription to the shell's error reply.
- A deprecated SDK export remains functional for the rest of the current major,
  carries an `@deprecated` note with its replacement and is removed only at the
  next major.
- The manifest `schemaVersion`, `engines.exo` range and shell version are
  independent inputs. The SDK never parses, validates or rewrites a manifest, and
  it does not infer capabilities from `shell.version`.
- A protocol mismatch is actionable: the SDK raises a named error with expected
  and received versions before any phase message, and the shell's plugin log
  reports `unsupported-version`.
- The release checklist, communication channels and upgrade-note requirement for
  a breaking change are in [`releases.md`](../releases.md).

## 10. Starter template and deployment

`packages/plugin-template` is a headless plugin built only on the SDK:

- `plugin.html` connects in register mode, registers `**/*.template.txt` against
  `editor.html`, completes and records the acknowledgement.
- `editor.html` reads the file, reports dirty, appends a visible
  `[template save N]` marker on save, re-reads on external change, acknowledges
  dispose and records state in `#observation` and the title.
- The pages use no `localStorage`, IndexedDB, cookies or parent DOM access, so
  they work when the shell serves them from its own origin with
  `sandbox="allow-scripts"`.
- `negative/protocol-mismatch.html` requests protocol major 2, surfaces the SDK
  error and registers nothing. Its manifest declares no contributions.
- The development server is `http://localhost:5175/` with CORS. The build is
  copied to `/exo-editor/plugin-template/` after the shell budget, CSP and
  custom-element checks, so the deployment contains both the shell and the
  template child path while the budget continues to measure the shell only.

The reference code plugin (`apps/code-plugin`) consumes the same SDK for its
controller and every handler. It adds no SDK method, message or envelope field:
its visible surface, Monaco instance and language support are plugin-owned, and
the shell only reads the `rendering` manifest field. The plugin build is copied
to `/exo-editor/code-plugin/` after the same shell checks.

## 11. Conformance and isolation

- `apps/shell/src/plugins/sdk-conformance.test.ts` runs the SDK handshake,
  registration, editor and event clients against the real
  `RegistrationSession` and `HandlerSession` with the shell's frame test
  transport.
- The suite includes wrong-origin, wrong-source, wrong-mode, wrong-session and
  unsupported-version cases; each fails closed and leaves the shell state
  unchanged.
- The hand-rolled `apps/shell/public/plugin-host-fixture/` remains an independent
  protocol implementation. It is not migrated to the SDK, so a shared mistake in
  SDK and fixture is less likely to pass unnoticed.
- The shell imports the SDK only from tests. A composition guard rejects a
  production import, and `check-dist-no-sdk` rejects an SDK marker in the built
  shell bundle. The template is built separately and cannot enter the shell
  bundle.

## 12. Out of scope

Publishing to a registry, a documentation site, a plugin marketplace, a second
protocol implementation, plugin-to-plugin messaging, background frames, storage
for same-origin plugins, and plugin-rendered shell UI.
