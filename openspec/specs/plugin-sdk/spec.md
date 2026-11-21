# plugin-sdk Specification

## Purpose

Defines the typed client library and starter template plugin authors use to
implement the Exo plugin protocol, including strict sender and identity checks,
DOM independence, and the compatibility policy tying the SDK, protocol and
manifest versions together.

## Requirements

### Requirement: DOM-independent typed core

The SDK SHALL expose the v1 protocol constants, envelope types, payload types and
message helpers from a core that performs no DOM access when imported, and SHALL
reach the browser only through an explicit adapter or an injected transport.

#### Scenario: Import outside a browser

- **WHEN** the package is imported in a non-browser runtime with no `window`,
  `document`, `location` or `parent`
- **THEN** the import succeeds and the protocol constants and envelope helpers are
  usable

#### Scenario: Browser adapter reads the fragment

- **WHEN** the browser adapter starts in a frame whose fragment contains
  `exo-host`, `exo-mode` and `exo-session`
- **THEN** it exposes those values as the host origin, mode and session id without
  requiring the plugin author to parse the fragment

#### Scenario: Injected transport drives a session

- **WHEN** a test supplies an injected transport instead of the browser adapter
- **THEN** the handshake, registration and editor clients operate without any DOM
  global

### Requirement: Strict sender and identity validation

The SDK SHALL process a shell message only when its source is the parent window
and its origin equals the `exo-host` origin, SHALL require `shell/init.sessionId`
and `shell/init.mode` to echo the fragment's `exo-session` and `exo-mode`, and
SHALL drop other messages without dispatching them to the plugin.

#### Scenario: Foreign origin is dropped

- **WHEN** a message with a valid envelope arrives from an origin other than
  `exo-host`
- **THEN** the SDK ignores it and no client callback or pending request observes
  it

#### Scenario: Wrong source is dropped

- **WHEN** a message arrives from the expected origin but not from the parent
  window
- **THEN** the SDK ignores it and does not resolve a pending request

#### Scenario: Session echo mismatch

- **WHEN** `shell/init` carries a session id different from the fragment's
  `exo-session`
- **THEN** the SDK rejects the initialization and reports an identity error
  instead of exposing the payload

#### Scenario: Mode echo mismatch

- **WHEN** a registration frame receives `shell/init` with mode `editor`, or an
  editor frame receives mode `register`
- **THEN** the SDK rejects the initialization and does not send a phase message

#### Scenario: Malformed envelope is ignored

- **WHEN** a message is not an object, lacks `exo: 1`, or has an invalid `id` or
  `replyTo`
- **THEN** the SDK drops it without throwing into the plugin's message handler

### Requirement: Outgoing messages target the shell origin only

The SDK SHALL address every `postMessage` it sends to the `exo-host` origin and
SHALL never use `*`. It SHALL refuse to start when the fragment has no valid
`exo-host`, `exo-mode` or `exo-session`.

#### Scenario: Handshake targets the host

- **WHEN** the SDK sends `plugin/ready` from a cross-origin or same-origin
  sandboxed frame
- **THEN** the target origin is the exact `exo-host` origin, never `*`

#### Scenario: Missing fragment parameters

- **WHEN** the fragment lacks `exo-host`, carries an invalid host, or lacks
  `exo-mode` or `exo-session`
- **THEN** the SDK reports a bootstrap error before sending any message

#### Scenario: Top-level page refuses to start

- **WHEN** the browser adapter runs in a top-level page where the parent is the
  page itself
- **THEN** it reports a bootstrap error instead of treating its own messages as
  shell messages

### Requirement: Typed handshake

The SDK SHALL send `plugin/ready` once with the supported protocol version and
the fragment session id, SHALL wait for and validate `shell/init`, and SHALL
expose a typed initialization object. A rejected or mismatched protocol major
SHALL produce a named error carrying the expected and received versions.

#### Scenario: Handshake succeeds

- **WHEN** the shell replies to `plugin/ready` with a matching protocol major,
  mode and session id
- **THEN** the SDK exposes the plugin, shell, workspace, theme, permissions,
  locale, settings and mode-specific file, capabilities and limits fields with
  their declared types

#### Scenario: Unsupported protocol major is actionable

- **WHEN** the shell rejects the protocol major with `shell/error`
  `unsupported-version`, or `shell/init` reports a different major
- **THEN** the SDK rejects with an error naming the expected and received
  versions, sends no registration or file message, and does not wait for the
  ready timeout

#### Scenario: Initialization timeout

- **WHEN** no valid `shell/init` arrives within the protocol's 10-second ready
  window
- **THEN** the SDK rejects the handshake with a timeout error naming the plugin's
  mode

#### Scenario: Ready is sent once

- **WHEN** the handshake is started twice or retried after an error
- **THEN** the SDK does not send a second `plugin/ready` for the same frame

### Requirement: Registration client

The SDK SHALL let a controller register file-editor contributions and declared
command ids, signal completion exactly once, and expose the shell's accepted
globs, accepted command ids and per-contribution rejection reasons from
`shell/register-ack`.

#### Scenario: Register and complete

- **WHEN** a controller registers a declared glob with an entry inside the plugin
  root and then completes
- **THEN** the SDK sends both messages in order and resolves with the
  acknowledgement

#### Scenario: Register a command

- **WHEN** a controller registers a declared command id and completes
- **THEN** the SDK sends the id in `plugin/register` and the acknowledgement
  exposes it in `acceptedCommands`

#### Scenario: Rejection details are exposed

- **WHEN** the acknowledgement rejects a contribution
- **THEN** the SDK exposes its index, kind, reason and optional message without
  discarding the accepted globs or command ids

#### Scenario: Missing command support

- **WHEN** an older shell acknowledges a registration without `acceptedCommands`
- **THEN** the SDK reports an empty accepted-command list and does not fail the
  editor registrations

#### Scenario: Registration only in register mode

- **WHEN** an editor-mode client is asked to register an editor or a command
- **THEN** the SDK rejects the call locally and sends no registration message

### Requirement: Editor client

The SDK SHALL expose the initialized file metadata, read files by path and
encoding with correlated replies, report dirty state, request a shell save for the
bound document, answer save requests with text or bytes, expose external-change
and disposal notifications, and reject outstanding requests when the frame is
disposed.

#### Scenario: Metadata before content

- **WHEN** an editor frame completes its handshake
- **THEN** the SDK exposes the file metadata and no file content until the plugin
  calls the read method

#### Scenario: Read round trip

- **WHEN** the plugin reads a relative or absolute path
- **THEN** the SDK sends one `plugin/request-file` and resolves that request from
  the matching `shell/file-content`

#### Scenario: Read error

- **WHEN** the shell replies with `shell/error` for a read
- **THEN** the SDK rejects that read with the stable error code and leaves other
  pending requests untouched

#### Scenario: Dirty report

- **WHEN** the plugin reports a dirty or clean state
- **THEN** the SDK sends one `plugin/dirty` with the boolean value

#### Scenario: Request a save

- **WHEN** the plugin calls `requestSave()`
- **THEN** the SDK sends one id-less `plugin/request-save` notification with no
  content and does not create a correlated pending request

#### Scenario: Save request and result

- **WHEN** the shell sends `shell/request-save`
- **THEN** the SDK invokes the plugin's save handler, answers with
  `plugin/save-content` using the request's id as `replyTo`, and resolves the
  plugin's save call from the matching `shell/save-result`

#### Scenario: No save handler

- **WHEN** the shell requests a save but the plugin registered no save handler
- **THEN** the SDK sends no content and the shell's five-second timeout leaves
  the document dirty instead of writing an empty or invented payload

#### Scenario: External change notification

- **WHEN** the shell sends `shell/file-changed`
- **THEN** the SDK delivers its path, kind and optional version to the plugin
  without changing the plugin's dirty state

#### Scenario: Disposal

- **WHEN** the shell sends `shell/dispose`
- **THEN** the SDK rejects every outstanding request, marks the client closed,
  sends `plugin/dispose-ack` once, and ignores later messages

### Requirement: Event client

The SDK SHALL subscribe and unsubscribe by topic, correlate `shell/subscribed`
replies including sequence numbers and `unsupported-topic`, surface permission
and limit errors, and deliver typed `shell/event` payloads for the v1 catalog.

#### Scenario: Subscription carries a sequence

- **WHEN** a handler subscribes to a v1 topic
- **THEN** the SDK resolves with the topic and the current sequence number from
  `shell/subscribed`

#### Scenario: Unsupported topic

- **WHEN** the shell replies `unsupported-topic`
- **THEN** the SDK rejects the subscription with that code and adds no local
  subscription

#### Scenario: Permission denied

- **WHEN** the plugin lacks `events:subscribe` and the shell replies with
  `permission-denied`
- **THEN** the SDK rejects the subscription with that code and the plugin receives
  no events for the topic

#### Scenario: Typed event delivery

- **WHEN** a subscribed frame receives `shell/event`
- **THEN** the SDK delivers the topic, sequence and payload to the registered
  listener with the catalog's payload type

#### Scenario: Throwing listener is contained

- **WHEN** a plugin's event listener throws
- **THEN** the SDK contains the error, keeps the connection open and still
  delivers later messages

#### Scenario: Unsubscribe is local and immediate

- **WHEN** the plugin unsubscribes from a topic
- **THEN** the SDK sends `plugin/unsubscribe`, removes the local listener and does
  not wait for an acknowledgement the protocol does not define

#### Scenario: Unsolicited error is observable

- **WHEN** the shell sends `shell/error` without a `replyTo`, for example a
  `rate-limited` queue overflow
- **THEN** the SDK exposes that code to an error listener and does not throw into
  the plugin's event handler or close the connection

### Requirement: SDK, protocol and manifest compatibility policy

The SDK SHALL use SemVer with its MAJOR equal to the protocol major it speaks, SHALL allow additive optional fields and API additions only in a minor, SHALL require a new SDK and protocol major to remove or reinterpret a wire field, SHALL keep a deprecated API for the rest of the current major, and SHALL treat the manifest `schemaVersion`, `engines.exo` and shell version as independent inputs. Plugin-local event helpers are an additive minor: they do not change an existing method or the meaning of a shell topic.

#### Scenario: SDK major matches the protocol

- **WHEN** the SDK speaks protocol major `1`
- **THEN** its package major is `1` and it exports the protocol version constant rather than letting a plugin hard-code it

#### Scenario: Additive change stays minor

- **WHEN** a new optional protocol field or a new client helper is added without changing existing meaning
- **THEN** it ships in an SDK minor and an existing plugin continues to work

#### Scenario: Removal requires a major

- **WHEN** a wire field is removed or reinterpreted
- **THEN** the change requires a new SDK and protocol major, and the old major is not silently accepted

#### Scenario: Deprecation window

- **WHEN** an SDK API is deprecated
- **THEN** it remains functional and documented with its replacement for the rest of the current major and is removed only at the next major

#### Scenario: Manifest schema is independent

- **WHEN** a plugin adopts a newer SDK minor
- **THEN** its manifest still declares the same `schemaVersion` and `engines.exo` range unless the manifest contract itself changed, and the SDK does not parse or rewrite a manifest

#### Scenario: Local events stay minor

- **WHEN** `publishLocal()`, `subscribeLocal()` and `onLocalEvent()` ship
- **THEN** the SDK takes an additive minor version, the protocol major remains `1`, and existing editor and subscription methods keep their behavior

### Requirement: Starter template uses only the SDK

The template SHALL be a buildable plugin with a controller page and an editor
page that implement registration, reads, dirty reporting, saving and disposal
only through the SDK, SHALL contain no hand-written envelope, handshake,
registration or handler protocol code, and SHALL run on a second origin in
development and as a same-origin child path of the deployed shell.

#### Scenario: No hand-written protocol

- **WHEN** the template source and build output are inspected
- **THEN** they contain no direct `postMessage`, `exo: 1` envelope construction,
  `message` listener or handshake state machine outside the SDK dependency

#### Scenario: Build and dev server

- **WHEN** the template is built and its development server is started
- **THEN** it produces static pages plus a manifest and serves them on its own
  origin with the manifest readable across origins

#### Scenario: Same-origin deployment

- **WHEN** the built template is loaded from the shell's origin
- **THEN** it registers, reads, reports dirty and saves without using
  `localStorage`, IndexedDB, cookies or parent DOM access

#### Scenario: Actionable version mismatch

- **WHEN** a template diagnostic page reports an unsupported protocol major
- **THEN** it surfaces the SDK's named error with expected and received versions
  and the shell's plugin log records `unsupported-version`

### Requirement: Conformance and shell isolation

The SDK SHALL be exercised against the shell's real registration and handler
sessions in the shell test suite, including negative origin, source, mode and
session cases, and the shell SHALL NOT import the SDK at runtime.

#### Scenario: Registration conformance

- **WHEN** the SDK registration client runs against a real `RegistrationSession`
- **THEN** handshake, registration, acknowledgement and frame teardown complete
  with no protocol violation

#### Scenario: Editor conformance

- **WHEN** the SDK editor client runs against a real `HandlerSession`
- **THEN** init, read, dirty, save result, external change and disposal complete
  with the shell's version checks intact

#### Scenario: Negative cases fail closed

- **WHEN** the conformance harness delivers a wrong origin, wrong source, wrong
  mode or wrong session id
- **THEN** the SDK rejects or ignores it and the shell observes no unauthorized
  state change

#### Scenario: Shell bundle contains no SDK

- **WHEN** the production shell bundle is built
- **THEN** it contains no SDK module, marker or template code, and a guard test
  fails if that changes

### Requirement: Private workspace packaging

The SDK and template SHALL remain private workspace packages in this repository
for v1, SHALL be installed by the existing npm workspaces, and SHALL NOT be
published to a registry or vendored into the shell.

#### Scenario: Clean install links the packages

- **WHEN** a clean `npm ci` runs from the repository root
- **THEN** the shell and template resolve `@exo/plugin-sdk` from the workspace
  without a registry fetch

#### Scenario: No publication

- **WHEN** the packages are inspected
- **THEN** both are marked private, the SDK has no runtime dependency, and no
  publish workflow exists

### Requirement: Directory listing capability

The SDK SHALL include `workspace:list` in its permission union, SHALL expose `capabilities.directoryListing` as a boolean, SHALL parse an absent support bit as `false`, and SHALL NOT infer listing support from `workspace:read` or from the shell version.

#### Scenario: New shell advertises listing

- **WHEN** `shell/init` carries `capabilities.directoryListing: true`
- **THEN** the SDK exposes it to the plugin and allows `listDirectory()` after the permission check

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.directoryListing` field
- **THEN** the SDK exposes `false`, rejects `listDirectory()` locally with `unsupported-message` and sends no message

#### Scenario: Permission is separate

- **WHEN** the shell advertises listing but the manifest does not declare `workspace:list`
- **THEN** the SDK rejects `listDirectory()` locally with `permission-denied` and sends no message

#### Scenario: Permission union is explicit

- **WHEN** a plugin author writes a manifest permission list with `workspace:list`
- **THEN** the SDK's exported permission type accepts it and adds no inferred permission

### Requirement: Directory listing client

The SDK SHALL expose `EditorClient.listDirectory(path, options?)`, SHALL send one correlated `plugin/request-list` with the path and optional cursor, SHALL resolve with the page's entries and optional `nextCursor`, SHALL reject malformed replies with `protocol-violation`, and SHALL reject a pending listing with `closed` on disposal.

#### Scenario: First page

- **WHEN** the plugin calls `listDirectory('/assets')`
- **THEN** the SDK sends one `plugin/request-list` with a fresh id and resolves with the entries and optional `nextCursor` from the matching `shell/list-result`

#### Scenario: Next page

- **WHEN** the plugin passes the previous `nextCursor`
- **THEN** the SDK sends it unchanged and resolves the next page without exposing a cursor format

#### Scenario: Directory error

- **WHEN** the shell replies `not-a-directory`, `not-found`, `permission-denied`, `rate-limited` or `timeout` for a listing
- **THEN** the SDK rejects that call with the stable code and leaves other pending requests untouched

#### Scenario: Malformed page

- **WHEN** `shell/list-result` does not carry an entry array or carries an invalid entry shape
- **THEN** the SDK rejects the call with `protocol-violation` and exposes no partial entries

#### Scenario: Disposal

- **WHEN** the handler is disposed while a listing request is pending
- **THEN** the SDK rejects the pending call with `closed` and sends no further listing message

#### Scenario: Additive minor

- **WHEN** `listDirectory()` ships
- **THEN** the SDK takes an additive minor version, the protocol major remains `1`, and existing editor methods keep their behavior

#### Scenario: Exact-path fallback

- **WHEN** `listDirectory()` rejects locally with `unsupported-message` because the shell predates the message
- **THEN** the plugin keeps exact-path reads and, when the picker change is present, the user picker as its fallback

### Requirement: Local events capability

The SDK SHALL expose `capabilities.localEvents` as a boolean initialized from `shell/init`, SHALL parse an absent support bit as `false`, and SHALL NOT infer local-event support from `events:subscribe`, the shell version or the presence of another capability.

#### Scenario: New shell advertises local events

- **WHEN** `shell/init` carries `capabilities.localEvents: true`
- **THEN** the SDK exposes it and allows local publication and subscription after the permission check

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.localEvents` field
- **THEN** the SDK exposes `false`, rejects local calls locally with `unsupported-message` and sends no message

#### Scenario: Permission is separate

- **WHEN** the shell advertises local events but the manifest does not declare `events:subscribe`
- **THEN** the SDK rejects local publication and subscription with `permission-denied` and sends no message

### Requirement: Local event client

The SDK SHALL expose `EditorClient.publishLocal(topic, payload)` and `EditorClient.subscribeLocal(topic)`, SHALL send one correlated `plugin/publish` or `plugin/subscribe`, SHALL validate the local topic and 1 MiB payload limit locally, SHALL resolve the publish from `shell/published`, and SHALL deliver local `shell/event` payloads to `onLocalEvent(topic, listener)`.

#### Scenario: Publish and acknowledge

- **WHEN** the plugin calls `publishLocal('local/state', { ready: true })`
- **THEN** the SDK sends one `plugin/publish` with a fresh id and resolves with the topic and sequence number from the matching `shell/published`

#### Scenario: Subscribe to a local topic

- **WHEN** the plugin calls `subscribeLocal('local/state')`
- **THEN** the SDK sends one `plugin/subscribe` and resolves with the topic and current sequence from `shell/subscribed`

#### Scenario: Local event delivery

- **WHEN** a subscribed frame receives a local `shell/event`
- **THEN** the SDK delivers the topic, sequence, `from` and payload to the registered listener without interpreting the payload

#### Scenario: Oversized local payload

- **WHEN** the plugin publishes a payload larger than 1 MiB
- **THEN** the SDK rejects locally with `too-large` and a message naming the limit, and sends no message

#### Scenario: Malformed local topic

- **WHEN** the plugin publishes or subscribes to `local/`, `local/State` or `local/a/b`
- **THEN** the SDK rejects locally with `unsupported-topic` and sends no message

#### Scenario: Shell topic is rejected locally

- **WHEN** the plugin calls `publishLocal('theme/changed', {})`
- **THEN** the SDK rejects with `permission-denied` and sends no message

#### Scenario: No replay

- **WHEN** the plugin subscribes after a local event was published
- **THEN** the SDK resolves with the current sequence and does not synthesize the missed event

#### Scenario: Publish without the support bit

- **WHEN** `capabilities.localEvents` is false or absent
- **THEN** `publishLocal()` and `subscribeLocal()` reject with `unsupported-message` and the plugin keeps its existing per-frame fallback

#### Scenario: Disposal rejects pending local calls

- **WHEN** the shell sends `shell/dispose` while a local publish or subscribe is pending
- **THEN** the SDK rejects that call with `closed` and sends no further local message

#### Scenario: Throwing local listener is contained

- **WHEN** a plugin's local event listener throws
- **THEN** the SDK contains the error, keeps the connection open and still delivers later events

#### Scenario: Unsubscribe is local and immediate

- **WHEN** the plugin unsubscribes from a local topic
- **THEN** the SDK sends `plugin/unsubscribe`, removes the local listener and does not wait for an acknowledgement the protocol does not define

### Requirement: View connection and client

The SDK SHALL accept `exo-mode=view` in the browser fragment, SHALL perform the same handshake and sender validation as editor mode, SHALL return a `{ mode: 'view' }` connection with the typed `ViewInit`, and SHALL expose a `ViewClient` with mediated reads, listings, file picker, local events, navigation intents and panel requests.

#### Scenario: View mode is parsed

- **WHEN** the fragment carries `exo-mode=view`
- **THEN** the SDK starts a view connection instead of rejecting the mode

#### Scenario: View handshake

- **WHEN** the shell replies with `shell/init` carrying `mode: "view"` and the matching session id
- **THEN** the SDK exposes the view block, plugin, shell, workspace, theme, permissions, settings, limits and capabilities

#### Scenario: View reads

- **WHEN** the plugin calls `readFile()` or `listDirectory()` from a view frame
- **THEN** the SDK uses the same correlated request and reply handling as `EditorClient`

#### Scenario: No save or dirty methods

- **WHEN** a plugin holds a view connection
- **THEN** the SDK exposes no save, dirty or `shell/request-save` handling for that client

#### Scenario: View initialization is immutable

- **WHEN** a content view opens with a payload
- **THEN** the SDK exposes the payload and instance id for the lifetime of the connection and does not fetch or rewrite them

#### Scenario: View disposal

- **WHEN** the shell sends `shell/dispose` to a view frame
- **THEN** the SDK rejects outstanding requests, sends `plugin/dispose-ack` once and ignores later messages

### Requirement: View registration

`RegistrationClient` SHALL let a controller register declared panel and content-view ids, SHALL send them in `plugin/register`, and SHALL expose the shell's accepted contributions and per-kind rejection reasons from `shell/register-ack`.

#### Scenario: Register a panel

- **WHEN** a controller registers a declared panel id and completes
- **THEN** the SDK sends the id in `plugin/register` and the acknowledgement exposes the accepted panel

#### Scenario: Register a content view

- **WHEN** a controller registers a declared content-view id
- **THEN** the SDK sends the id and the acknowledgement exposes the accepted view

#### Scenario: Undeclared id

- **WHEN** the shell rejects a panel or content-view id with `not-declared`
- **THEN** the SDK exposes the kind, index, reason and optional message without discarding accepted contributions

#### Scenario: Registration only in register mode

- **WHEN** an editor or view client is asked to register a panel or content view
- **THEN** the SDK rejects the call locally and sends no registration message

#### Scenario: Additive acknowledgement

- **WHEN** the shell's `shell/register-ack` carries the existing `accepted` globs and the new contribution list
- **THEN** the SDK preserves both and does not reinterpret the glob list

### Requirement: View navigation and panel helpers

The SDK SHALL expose `openFile(path)`, `openView(options)` and `requestPanel(panel, action)` on both `EditorClient` and `ViewClient`, SHALL preflight the support bit, permission, target shape and 64 KiB payload before sending, and SHALL resolve each helper from its correlated result or reject with the shell's stable error code.

#### Scenario: Open a file

- **WHEN** the plugin calls `openFile('/src/a.ts')`
- **THEN** the SDK sends one `plugin/open-file` with a fresh id and resolves from `shell/open-result`

#### Scenario: Relative path deprecation

- **WHEN** an editor client calls `openFile('./sibling.ts')`
- **THEN** the SDK sends the path unchanged and lets the shell resolve it against the document, while a view client rejects a relative path locally with `permission-denied`

#### Scenario: Cross-plugin open

- **WHEN** the plugin calls `openView({ pluginId: 'com.example.other', viewId: 'tutorial', payload: { chapter: 2 } })`
- **THEN** the SDK sends one `plugin/open-view` and resolves from `shell/open-result`

#### Scenario: Same-plugin open

- **WHEN** the plugin calls `openView({ viewId: 'tutorial' })`
- **THEN** the SDK omits `pluginId` and the shell targets the caller's own plugin

#### Scenario: Payload limit

- **WHEN** the payload exceeds 64 KiB
- **THEN** the SDK rejects locally with `too-large` and a message naming the actual size and the limit, and sends no message

#### Scenario: Unsupported shell

- **WHEN** the relevant `capabilities.openFile`, `openView` or `requestPanel` bit is absent
- **THEN** the helper rejects with `unsupported-message` and sends no message

#### Scenario: Panel request

- **WHEN** the plugin calls `requestPanel('outline', 'show')`
- **THEN** the SDK sends one `plugin/request-panel` and resolves with the panel id and resulting open state

#### Scenario: Hidden frame is rejected

- **WHEN** the shell replies `permission-denied` because the frame is hidden or inactive
- **THEN** the helper rejects with that code and the plugin keeps its current layout

#### Scenario: Disposal

- **WHEN** the frame is disposed while a navigation or panel request is pending
- **THEN** the SDK rejects the call with `closed` and sends no further message

### Requirement: View capability negotiation

The SDK SHALL expose `capabilities.openFile`, `capabilities.openView`, `capabilities.requestPanel` and `capabilities.localEvents` as booleans, SHALL parse an absent bit as `false`, and SHALL NOT infer support from the shell version, another capability or the manifest permissions.

#### Scenario: New shell advertises view intents

- **WHEN** `shell/init` carries the view intent support bits as true
- **THEN** the SDK exposes them and allows the helpers after their permission checks

#### Scenario: Older shell omits support

- **WHEN** a support bit is absent
- **THEN** the SDK exposes `false` and the corresponding helper rejects locally

#### Scenario: Permission is separate

- **WHEN** `capabilities.openFile` is true but the plugin lacks `workspace:read`
- **THEN** `openFile()` rejects locally with `permission-denied` and sends no message

#### Scenario: View and editor agree

- **WHEN** the same plugin opens an editor and a view frame
- **THEN** both initializations expose the same support bits

#### Scenario: Additive minor

- **WHEN** the view client and helpers ship
- **THEN** the SDK takes an additive minor version `1.5.0`, the protocol major remains `1`, and existing editor methods keep their behavior

### Requirement: Command handler client

The SDK SHALL expose `onCommand(handler)` on editor and view clients, SHALL invoke the handler with the command id and optional `{ path, kind }` arguments, and SHALL answer each invocation with `plugin/command-result` using the invocation id as `replyTo`. A resolved handler SHALL produce `{ ok: true }`; a thrown error or an explicit failure SHALL produce `{ ok: false }` with a message of at most 200 characters.

#### Scenario: Command handler

- **WHEN** the shell sends `shell/command` for a registered command
- **THEN** the SDK invokes the attached handler with the id and arguments and sends one success result

#### Scenario: Explorer arguments

- **WHEN** the invocation carries `{ path: "/notes.txt", kind: "file" }`
- **THEN** the handler receives both fields unchanged and no file content

#### Scenario: Handler failure

- **WHEN** the handler throws or returns a failure
- **THEN** the SDK sends `{ ok: false }` with a bounded message and does not throw into the frame

### Requirement: Command buffering and capability

The SDK SHALL expose `capabilities.commands` with absence treated as `false`, SHALL queue up to ten `shell/command` messages that arrive before a handler is attached, and SHALL ignore later command messages after disposal.

#### Scenario: Early command

- **WHEN** `shell/command` arrives before the plugin attaches a handler
- **THEN** the SDK queues it up to ten messages and dispatches it when the handler is attached

#### Scenario: Queue overflow

- **WHEN** more than ten commands arrive with no handler attached
- **THEN** the SDK answers the excess with a failure result instead of growing an unbounded queue

#### Scenario: Older shell

- **WHEN** `shell/init` omits `capabilities.commands`
- **THEN** the client reports command delivery as unsupported and `onCommand` sends no message

#### Scenario: Disposal

- **WHEN** the frame is disposed with an invocation in flight
- **THEN** the SDK rejects the handler, sends no result for the disposed invocation and ignores later command messages

### Requirement: New-file client

`EditorClient` and `ViewClient` SHALL expose `requestNewFile({ text | bytes, suggestedName?, directory? })`, SHALL send one correlated `plugin/request-new-file`, SHALL preflight the support bit, `workspace:write` and the 8 MiB size, and SHALL resolve `{ path, version }` or `null` for a user cancellation.

#### Scenario: Text request

- **WHEN** the plugin calls `requestNewFile({ text: 'hello', suggestedName: 'notes.md' })`
- **THEN** the SDK sends one `plugin/request-new-file` with a fresh id and resolves with the path and version from `shell/new-file-result`

#### Scenario: Bytes request

- **WHEN** the plugin calls `requestNewFile({ bytes })`
- **THEN** the SDK sends the bytes unchanged and resolves with the created path and version

#### Scenario: Cancel is not an error

- **WHEN** the shell replies `{ cancelled: true }`
- **THEN** the SDK resolves `null` and does not reject

#### Scenario: Oversized content

- **WHEN** the text or bytes exceed 8 MiB
- **THEN** the SDK rejects locally with `too-large` and a message naming the actual size and the limit, and sends no message

#### Scenario: Older shell

- **WHEN** `capabilities.createFile` is false or absent
- **THEN** the SDK rejects with `unsupported-message` and sends no message

#### Scenario: Missing write permission

- **WHEN** the manifest lacks `workspace:write`
- **THEN** the SDK rejects with `permission-denied` and sends no message

#### Scenario: Collision

- **WHEN** the shell replies `already-exists`
- **THEN** the SDK rejects with that code and message and the plugin can offer another name

#### Scenario: Disposal

- **WHEN** the frame is disposed while the request is pending
- **THEN** the SDK rejects with `closed` and sends no further create request

#### Scenario: Additive minor

- **WHEN** `requestNewFile()` ships
- **THEN** the SDK takes an additive minor version `1.7.0`, the protocol major remains `1`, and existing methods keep their behavior

### Requirement: New-file registration

`RegistrationClient` SHALL let a controller register declared new-file template ids, SHALL send them in `plugin/register`, and SHALL expose accepted templates and per-kind rejection reasons from `shell/register-ack`.

#### Scenario: Register a template

- **WHEN** a controller registers a declared template id and completes
- **THEN** the SDK sends the id and the acknowledgement exposes the accepted template

#### Scenario: Undeclared template

- **WHEN** the shell rejects a template id with `not-declared`
- **THEN** the SDK exposes the kind, index, reason and optional message without discarding accepted contributions

#### Scenario: Registration only in register mode

- **WHEN** an editor or view client is asked to register a template
- **THEN** the SDK rejects the call locally and sends no registration message

#### Scenario: Additive acknowledgement

- **WHEN** `shell/register-ack` carries accepted globs, panels, content views and new-file templates
- **THEN** the SDK preserves each list and does not reinterpret one as another

### Requirement: New-file capability

The SDK SHALL expose `capabilities.createFile` on editor and view initializations and `capabilities.newFiles` on registration initializations, SHALL parse an absent bit as `false`, and SHALL NOT infer support from `workspace:write`, the shell version or another capability.

#### Scenario: Editor and view creation support

- **WHEN** an editor or view frame receives `capabilities.createFile: true`
- **THEN** `requestNewFile()` is available after the permission check

#### Scenario: Registration support

- **WHEN** a registration frame receives `capabilities.newFiles: true`
- **THEN** `registerNewFile()` is available and sends a registration message

#### Scenario: Older shell omits support

- **WHEN** a support bit is absent
- **THEN** the SDK exposes `false` and rejects the corresponding helper locally with `unsupported-message`

#### Scenario: Support is not permission

- **WHEN** `capabilities.createFile` is true but the manifest lacks `workspace:write`
- **THEN** `requestNewFile()` rejects locally with `permission-denied` and sends no message

### Requirement: File picker client

The SDK SHALL expose `EditorClient.requestFiles(options?)`, SHALL send one correlated `plugin/request-files` only when `capabilities.filePicker` and `capabilities.requestFiles` are true, SHALL resolve with the selected paths as a `string[]`, SHALL allow at most one pending picker request per client, and SHALL treat an absent `filePicker` bit as unsupported.

#### Scenario: Request round trip

- **WHEN** the plugin calls `requestFiles({ multiple: true })` and the shell accepts it
- **THEN** the SDK sends one `plugin/request-files` with a fresh id and resolves the call with the `string[]` from the matching `shell/files-selected`

#### Scenario: User cancels

- **WHEN** the shell replies with an empty `paths` array
- **THEN** the SDK resolves the call with `[]` and does not treat it as an error

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.filePicker` field
- **THEN** the SDK parses it as `false`, rejects `requestFiles()` locally with `unsupported-message`, and sends no message

#### Scenario: Missing read permission

- **WHEN** `capabilities.requestFiles` is `false`
- **THEN** the SDK rejects `requestFiles()` locally with `permission-denied` and sends no message

#### Scenario: One pending picker

- **WHEN** the plugin calls `requestFiles()` while a previous picker request is still pending in the same client
- **THEN** the second call rejects locally with `rate-limited` and sends no second message

#### Scenario: Shell error is correlated

- **WHEN** the shell replies `shell/error` with `replyTo` equal to the picker request id
- **THEN** the SDK rejects that call with the shell's stable code and leaves other pending requests untouched

#### Scenario: Malformed selection reply

- **WHEN** `shell/files-selected` does not carry an array of strings in `paths`
- **THEN** the SDK rejects the picker request with `protocol-violation` and does not expose the payload

#### Scenario: Disposal while the picker is pending

- **WHEN** the handler is disposed while a picker request is pending
- **THEN** the SDK rejects the pending call with `closed` and sends no further picker message

#### Scenario: Additive minor release

- **WHEN** the helper ships
- **THEN** the SDK version is `1.2.0`, the protocol major remains `1`, and existing editor methods keep their behavior
