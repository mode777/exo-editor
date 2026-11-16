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
| `packages/plugin-sdk` (`@exo/plugin-sdk`)           | `1.0.0` | Private workspace package; no runtime dependency |
| `packages/plugin-template` (`@exo/plugin-template`) | `0.1.0` | Private workspace package; built static assets   |

- The SDK MAJOR equals the protocol major it speaks. `PROTOCOL_VERSION` and
  `SDK_VERSION` are exported constants; a plugin must not hard-code the protocol
  number.
- The packages are not published in v1 (D12). Consumers in this repository use
  the workspace copy. A future publication adds a built `dist` and does not
  change the message protocol.
- The SDK core is DOM-free: importing `@exo/plugin-sdk` does not read `window`,
  `document`, `location` or `parent`. `@exo/plugin-sdk/browser` is the only entry
  point that does, and it is what a browser plugin imports.

## 3. Browser bootstrap

The browser adapter reads the fragment the shell puts on the frame URL:

```text
#exo-host=https%3A%2F%2Feditor.example.com&exo-mode=editor&exo-session=<opaque-id>
```

- `exo-host` must be an absolute `http` or `https` origin with no path, query,
  credentials or fragment. The adapter returns `url.origin`.
- `exo-mode` must be `register` or `editor`.
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
```

A protocol mismatch raises `ExoProtocolError` with code `unsupported-version`,
`expected` (the SDK's supported major) and `received` (the version the shell
reported, or the version the shell rejected). No registration or file message is
sent after the failure.

## 6. Registration client

`RegistrationClient` is only available on a register-mode connection.

```text
register({ glob, entry, label? })   -> one plugin/register
complete()                          -> one plugin/register-complete, then shell/register-ack
```

- `complete()` resolves with `{ accepted: string[], rejected: RejectedContribution[] }`.
  Each rejection carries its index, stable reason and optional message.
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
editor.capabilities // read, write, requestFiles
editor.limits // maxFileSize, maxRequestBytes
editor.settings // resolved shell settings
editor.readFile(path, 'utf8' | 'binary')
editor.setDirty(dirty)
editor.onSaveRequest(handler)
editor.onSaveResult(listener)
editor.onFileChanged(listener)
editor.onDispose(listener)
editor.onError(listener)
editor.subscribe(topic)
editor.unsubscribe(topic)
editor.onEvent(topic, listener)
```

- Reads send `plugin/request-file` with a per-frame monotonic id and resolve from
  the matching `shell/file-content`. A matching `shell/error` rejects that read
  with its stable code and leaves other requests pending.
- The SDK allows at most 64 in-flight requests per frame. The next request
  rejects locally with `rate-limited`.
- `setDirty` sends one `plugin/dirty` with the boolean value. The SDK never
  infers dirty state from a DOM event.
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

## 8. Event client

- `subscribe(topic)` sends `plugin/subscribe` and resolves `{ topic, seq }` from
  `shell/subscribed`. `unsupported-topic` and `permission-denied` reject the
  promise with that code.
- `unsubscribe(topic)` sends `plugin/unsubscribe`, removes the local listener and
  returns immediately; the protocol defines no acknowledgement.
- `onEvent(topic, listener)` receives `{ topic, seq, payload }` for that topic.
  A throwing listener is contained and later events still arrive.
- Topic names and payloads are the v1 catalog in [`events.md`](./events.md).

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
- A deprecated SDK export remains functional for the rest of the current major,
  carries an `@deprecated` note with its replacement and is removed only at the
  next major.
- The manifest `schemaVersion`, `engines.exo` range and shell version are
  independent inputs. The SDK never parses, validates or rewrites a manifest, and
  it does not infer capabilities from `shell.version`.
- A protocol mismatch is actionable: the SDK raises a named error with expected
  and received versions before any phase message, and the shell's plugin log
  reports `unsupported-version`.

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
