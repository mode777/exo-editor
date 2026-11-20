# Plugin Protocol Contract (v1)

Status: ratified by the OpenSpec change `define-core-contracts`. Normative
requirements are mirrored in `openspec/specs/plugin-protocol/spec.md`.

## 1. Purpose

Defines the only channel between the shell and plugin iframes: a versioned
`postMessage` protocol with a shared envelope, a handshake, a short-lived
registration phase and a per-document handler session.

There are two frame lifetimes and one protocol:

| Frame | Lifetime | Page | Purpose |
| --- | --- | --- | --- |
| Registration | One per plugin per workspace load (or on add) | `runtime.entry` (controller) | Confirm contributions, then unload |
| Handler | One per open document | `contributes.fileEditors[].entry` for the matched editor | Init with metadata, answer reads, report dirty, produce content on save |

A registration frame is always hidden. A handler frame is hidden unless its
manifest contribution declares `rendering: "frame"`, in which case the shell
displays it in the document area for the active document. A visible handler frame
renders only inside its own iframe; it never renders shell chrome.

## 2. Envelope

Every message is a structured-cloneable object:

```ts
export interface Envelope<T = unknown> {
  /** Protocol marker. Messages without it are ignored. */
  exo: 1
  /** Namespaced type: 'plugin/*' from the plugin, 'shell/*' from the shell. */
  type: string
  /** Request id, present when the message expects a correlated reply. */
  id?: string
  /** The `id` of the request being answered. */
  replyTo?: string
  payload?: T
}
```

Rules:

- `type` must be a known type for the direction. Unknown types are ignored and,
  for a message with an `id`, answered with `shell/error` code
  `unsupported-message`.
- `id` values are opaque strings, at most 64 characters, unique per frame and
  direction. A reply must echo the request's `id` in `replyTo`.
- A frame may have at most 64 in-flight requests.
- Payloads are plain objects or typed arrays. No functions, no `MessagePort`
  transfer in v1.
- The shell drops any message that is not from the frame's `contentWindow` or not
  shaped like an envelope. It does not reply to rejected messages (that would be
  an oracle).
- Origin validation depends on the sandbox mode:
  - **Cross-origin frame**: `event.origin` must equal the plugin origin.
  - **Same-origin frame with an opaque origin**: the browser serializes the
    origin as `"null"`. The shell accepts `"null"` only when
    `event.source === iframe.contentWindow` and the `plugin/ready` payload echoes
    the frame's `exo-session` value. Identity is the frame instance, not an
    origin, because a sandboxed same-origin frame has no origin to name.

## 3. Bootstrap

### 3.1 Frame URL

```text
# controller, mounted for the registration phase
https://plugins.example.com/monaco/plugin.html
  #exo-host=https%3A%2F%2Feditor.example.com
  &exo-mode=register
  &exo-session=<opaque-id>

# editor, mounted for one open document
https://plugins.example.com/monaco/editors/code.html
  #exo-host=https%3A%2F%2Feditor.example.com
  &exo-mode=editor
  &exo-session=<opaque-id>

# view, mounted for one panel or content-view tab
https://plugins.example.com/monaco/views/outline.html
  #exo-host=https%3A%2F%2Feditor.example.com
  &exo-mode=view
  &exo-session=<opaque-id>
```

- The editor or view URL is inside the plugin root (the controller entry's
  directory): it may be a sibling of the controller page or a descendant. The
  shell never substitutes the controller entry for a contribution entry.
- Parameters are in the fragment so they are not sent to the plugin's server and
  do not affect caching.
- `exo-host` is the shell origin. A plugin MUST post only to this origin; posting
  to `*` is a protocol violation the shell cannot detect but reviewers must
  reject.
- `exo-session` identifies the frame instance. It is not a capability and grants
  nothing, but it binds `plugin/ready` to the frame for opaque-origin plugins
  where `event.origin` is `"null"`.
- `exo-mode` lets an entry page choose an initial UI before the first message.
  The shell's first message is authoritative.

### 3.2 Handshake

1. Shell mounts the iframe with `allow=""`, `referrerpolicy="no-referrer"`,
   `loading="eager"`, no `allowfullscreen`, no `allow-popups` and no
   `allow-top-navigation`. The sandbox depends on the origin:

   | Plugin origin | `sandbox` | Consequence |
   | --- | --- | --- |
   | Cross-origin | `allow-scripts allow-same-origin` | Keeps its own storage; cannot reach the parent |
   | Same as shell | `allow-scripts` | Opaque origin: no storage, cookies or parent DOM |

   A same-origin plugin never receives `allow-same-origin`, because that
   combination would let it remove its own sandbox. Same-origin plugins are
   first-party only and lose plugin storage (D3, D9).

   Registration frames are always hidden. A handler frame is hidden unless the
   selected manifest contribution declares `rendering: "frame"`; a visible
   handler is positioned inside the active document area, hidden without
   disposal when its tab is inactive, and still has no shell DOM access. The
   visibility flag is manifest metadata and is not sent in `shell/init`.
   A view frame is displayed only inside the shell-owned placeholder for its
   panel or content-view tab; it is hidden without disposal when switched away
   and never receives a shell DOM node.
2. Plugin sends `plugin/ready` with
   `{ protocolVersion: "1", sessionId: "<echo of exo-session>" }`.
3. Shell verifies origin and source, then replies `shell/init`:

```ts
interface ShellInit {
  protocolVersion: '1'
  mode: 'register' | 'editor' | 'view'
  sessionId: string
  plugin: { id: string; version: string }
  shell: { version: string; origin: string }
  workspace: { name: string }
  theme: 'dark' | 'light' | 'high-contrast'
  permissions: PluginPermission[]
  locale: string
  /**
   * Resolved workspace-scoped settings for this plugin. Always present; `{}`
   * when the plugin declares no configuration. Never contains file content.
   */
  settings: Record<string, boolean | string | number>
  /** Present only when mode is 'editor'. Never contains file content. */
  file?: FileMetadata
  /** Present only when mode is 'view'. */
  view?: {
    kind: 'panel' | 'content'
    id: string
    title: string
    instanceId: string
    location?: 'primary' | 'secondary'
    /** One-shot data supplied at open time; never file content. */
    payload?: unknown
    /** Present when another plugin opened this content view. */
    openedBy?: { pluginId: string; pluginName: string; origin: string }
  }
  /**
   * Registration init carries `{ localEvents }`. Editor and view init carry the
   * permission bits plus the shell support bits: `filePicker`,
   * `directoryListing`, `localEvents`, `openFile`, `openView`, `requestPanel` and
   * `commands` are absent on older shells and a plugin must treat absence as
   * false.
   */
  capabilities?: {
    read?: boolean
    write?: boolean
    requestFiles?: boolean
    filePicker?: boolean
    directoryListing?: boolean
    localEvents?: boolean
    openFile?: boolean
    openView?: boolean
    requestPanel?: boolean
    commands?: boolean
  }
  /** Present only when mode is 'editor' or 'view'. */
  limits?: { maxFileSize: number; maxRequestBytes: number }
}
```

4. Shell-to-plugin messages use the plugin's exact origin as the `postMessage`
   `targetOrigin`. The only exception is a same-origin plugin running with
   `allow-scripts` only: its frame has an opaque origin, so the shell uses `*`
   and relies on the frame instance plus the session id for identity. `*` is
   never used for a cross-origin frame, and no message sent to an opaque frame
   contains file content in the registration phase.
5. Plugin proceeds with registration or its first file request.

Frame init is not acknowledged and there is no heartbeat in v1; the first
request is the earliest liveness signal, and an unresponsive handler surfaces as
a failed save rather than a disconnect. Settings are resolved by the shell before
the frame mounts: a stored value that matches the declaration wins, otherwise the
declared default is sent. `config/changed` is the only live update channel and
requires `events:subscribe`; a new handler or view always receives the current
values in `shell/init`.

### 3.3 Phase rules

`exo-mode` fixes a frame's phase for its whole lifetime. The shell does not
reinterpret a frame that starts in one mode as the other.

| Phase | Allowed plugin messages |
| --- | --- |
| `register` | `plugin/ready`, `plugin/register`, `plugin/register-complete` |
| `editor` | `plugin/ready`, `plugin/request-file`, `plugin/request-files`, `plugin/request-list`, `plugin/dirty`, `plugin/request-save`, `plugin/save-content`, `plugin/subscribe`, `plugin/unsubscribe`, `plugin/publish`, `plugin/open-file`, `plugin/open-view`, `plugin/request-panel`, `plugin/command-result`, `plugin/dispose-ack` |
| `view` | `plugin/ready`, `plugin/request-file`, `plugin/request-files`, `plugin/request-list`, `plugin/subscribe`, `plugin/unsubscribe`, `plugin/publish`, `plugin/open-file`, `plugin/open-view`, `plugin/request-panel`, `plugin/command-result`, `plugin/dispose-ack` |

- `plugin/ready` is accepted once per frame. A second `ready`, a
  `plugin/register-complete` before `ready`, or a registration message after
  `register-complete` is a protocol violation.
- A message from another phase's row, and any other message sent before
  `ready`, is a protocol violation: the shell replies `shell/error` with
  `protocol-violation`, counts it toward the frame's budget and performs no state
  change.
- `plugin/save-content` is accepted only when it carries a `replyTo` matching the
  single live `shell/request-save`. Content with no live request, or for a
  request that already timed out, is ignored, never written, and counted as a
  protocol violation. A view frame has no save path; `plugin/dirty`,
  `plugin/request-save` and `plugin/save-content` are violations in the view
  phase.
- `plugin/publish` is accepted in the editor and view phases. A registration
  frame that sends it receives `protocol-violation`, publishes nothing and counts
  the message toward its budget.
- `plugin/request-save` is an id-less intent notification. It asks the shell to
  run the normal Save action for the handler's document; it carries no content
  and must not have an `id` or a non-empty payload. The shell may coalesce it
  with an in-flight save and ignores it for a clean, read-only or inactive
  document. An `id` or non-empty payload is a protocol violation.
- `shell/save-result` echoes the save request's `id` in `replyTo`; a plugin must
  correlate it rather than assuming completion order.

Timeouts: `plugin/ready` 10 s from mount; `plugin/register-complete` 10 s from
`shell/init`. On timeout the shell reports `timeout` with the plugin id and
phase, removes the iframe and rolls back partial registrations.

If the iframe fires `error` or fails to load, the shell reports `loading-failed`.
A `ready` from the wrong origin is dropped and counted; three drops remove the
frame with `protocol-violation`.

## 4. Registration phase

```text
plugin/register          { fileEditors?: FileEditorContribution[],
                           panels?: string[], contentViews?: string[],
                           commands?: string[] }
plugin/register-complete {}
shell/register-ack      { accepted: string[],
                          acceptedPanels: string[],
                          acceptedContentViews: string[],
                          acceptedCommands: string[],
                          rejected: RejectedContribution[] }

FileEditorContribution = { glob: string; entry: string; label?: string }
RejectedContribution   = { index: number,
                           reason: RegistrationRejection,
                           kind?: 'fileEditor' | 'panel' | 'contentView' | 'command',
                           message?: string }
RegistrationRejection  = 'not-declared' | 'permission-denied' | 'invalid-glob'
                       | 'invalid-contribution' | 'target-not-registered'
```

- `plugin/register` may be sent 0..n times before `plugin/register-complete`.
  Registrations are additive and validated on receipt; invalid entries are
  collected in `rejected` with an index and a reason and never become active.
- A registered `glob` must be declared exactly once in the manifest; a registered
  `entry` must resolve inside the plugin root. The glob may be paired with any
  page in that root, including one added after the manifest was approved (D14).
  An undeclared glob is rejected with `not-declared`; an entry outside the root
  is rejected with `permission-denied`. A register message after
  `register-complete` is a protocol violation (section 3.3), not a live update.
- A missing `label` defaults to the label of the manifest contribution for that
  glob. A supplied label must be 1-40 characters; otherwise the contribution is
  rejected with `invalid-contribution`. Priority is not part of the registration
  message: it always comes from the manifest contribution for the glob.
- A plugin must declare `workspace:read` or `workspace:write` to contribute a
  file editor. A manifest that declares `contributes.fileEditors` without either
  permission still validates, but every editor registration from it is rejected
  with `permission-denied` and the plugin contributes no editor.
- Identical `glob` and `entry` pairs registered more than once before completion
  produce one registry contribution.
- `shell/register-ack` is the last message the plugin receives. `accepted`
  contains the accepted glob strings; `rejected` contains one entry per rejected
  contribution, in registration order. The shell removes the iframe 250 ms later
  so the plugin can flush logs.
- Registrations become active only after `plugin/register-complete`. A plugin that
  never completes registers nothing.
- `panels` and `contentViews` are arrays of declared ids. The shell preserves
  arrival order, deduplicates repeated ids, and rejects an undeclared id with
  `not-declared`; a panel id never becomes active unless it was declared in
  `contributes.panels`, and likewise for content views. Only registered ids
  appear in the host snapshot, the activity bar, the picker or the palette.
- `shell/register-ack` is additive: `accepted` keeps its glob meaning,
  `acceptedPanels`, `acceptedContentViews` and `acceptedCommands` carry the view
  and command ids, and a `rejected` entry names its `kind` when it is not an
  editor. An older SDK ignores the extra fields; a newer SDK defaults their
  absence to empty arrays.
- `commands` is an array of declared command ids. The shell preserves arrival
  order and deduplicates repeated ids. An undeclared id is rejected with
  `not-declared`. At `plugin/register-complete` a command whose panel or
  content-view target was not registered in the same session is rejected with
  `target-not-registered`; the order of the panel and command registrations does
  not matter. A rejected command appears in no surface.
- Registration order is the order in which the shell accepted the contributions,
  and the plugin's declaration position in `exo.json` is the outer selection
  order. Equal-priority selection therefore never depends on network or handshake
  completion order.
- If the plugin declared no `contributes.fileEditors`, it may complete
  immediately; the shell records it as a configuration-only or event-only plugin
  for later layers.
- Both registration and editor `shell/init` messages carry the plugin's resolved
  workspace-scoped `settings` map. It is `{}` when the plugin declares no
  configuration and contains primitives only.
- A manifest that declares `fileEditors` but registers none is allowed (the user
  may have disabled all of them) and produces no editor.

## 5. Handler session

### 5.1 Init

The editor-mode `shell/init` carries the file block; there is no second init
message.

```ts
interface FileMetadata {
  path: string            // absolute within the workspace, '/'-rooted
  name: string
  dir: string
  size: number
  mtime: number
  version: string
  languageHint?: string   // extension-derived hint, not a guarantee
}
```

Content is **not** included. The plugin requests it.

Selection is format-agnostic: the shell does not decode, sniff or apply its text
size limit before mounting a handler. The shell text surface's binary, UTF-8 and
10 MiB verdicts apply only when no plugin editor matches. Reads are still subject
to `limits.maxRequestBytes`.

### 5.2 Reading

```text
plugin/request-file   { path, encoding: 'utf8' | 'binary' }
shell/file-content    { path, version, text } | { path, version, bytes: ArrayBuffer }
```

- Relative `path` is resolved against the handler file's directory. A leading `/`
  is workspace-absolute.
- The result is rejected inside the shell when the path escapes the root, hits a
  reserved path, exceeds `maxRequestBytes`, or the plugin lacks
  `workspace:read`.
- Multiple reads are allowed. The shell may serve from cache when `version`
  matches the cached stat; it always re-stats on the first request and after a
  `workspace/file-changed` notification.
- Errors: `shell/error { replyTo, code: 'not-found' | 'permission-denied' |
  'too-large' | 'not-a-file' | 'internal' }`.

### 5.2.1 User-mediated file selection

```text
plugin/request-files   { multiple?: boolean, directory?: WorkspacePath }
shell/files-selected   { paths: WorkspacePath[] }      // [] means cancelled
```

- `plugin/request-files` is an editor-phase, correlated request. It requires
  `workspace:read` and `capabilities.filePicker`. The shell SHALL reject it with
  `permission-denied` unless the handler is active, visible, focused and not
  disposing, and SHALL reply `rate-limited` when a picker is already open or the
  frame already has one pending.
- `multiple` defaults to `false`; a multiple selection returns at most 32 paths
  in selection order. `directory` is an optional start hint, not a grant. The
  shell normalizes and contains it and falls back silently to the handler file's
  directory when it is absent, invalid, reserved or missing.
- The picker is shell-owned. It lists directories lazily through the
  plugin-scoped workspace facade, so `/exo.json` and `/.exo/**` are neither
  shown nor returned. It re-checks the reserved set before replying. The plugin
  may not supply a title, message, description or preselected path; unknown
  request fields are a protocol violation.
- The reply carries `/`-rooted workspace paths only. It carries no content,
  stat, version, `FileSystemHandle`, `File` or `Blob`; the plugin reads a chosen
  path through `plugin/request-file` and the normal permission and size checks
  apply.
- A user cancellation is a successful `shell/files-selected` with `paths: []`.
  Disposal, tab close, tab switch, plugin removal and workspace switch close the
  picker without a reply; a late answer is dropped.
- The shell logs the plugin id, outcome and error code, not the selected paths.

### 5.2.2 Permissioned directory listing

```text
plugin/request-list   { path: WorkspacePath, cursor?: string }
shell/list-result     { entries: DirectoryEntry[], nextCursor?: string }

DirectoryEntry = { path: WorkspacePath, kind: 'file' | 'directory', size?: number }
```

- `plugin/request-list` is an editor-phase, correlated request. It requires the
  manifest permission `workspace:list`; a handler without it receives
  `permission-denied`, performs no provider listing and returns no entries.
  `workspace:list` is a manifest permission, not a shell capability:
  `capabilities.directoryListing` only says the shell implements the message.
- `path` is required. A relative path resolves against the handler file's
  directory; a leading `/` is workspace-absolute. The shell normalizes and
  contains the path, denies reserved requested directories with
  `permission-denied` and lists one directory level only. The reply never
  includes descendants of a listed child directory.
- The shell serves pages from a workspace-scoped, handler-bound snapshot created
  by the first request (no cursor). A page holds at most 1,000 direct children,
  sorted directories before files and then by path using the workspace's
  case-sensitivity rule. `nextCursor` is an opaque token and is present only when
  more entries remain. Later pages slice the same snapshot, so a create or delete
  between pages does not change them; a fresh request without a cursor observes
  the new state.
- An entry carries `path`, `kind` and, for files, a byte `size`. It carries no
  `mtime`, content version, content, handle, `File` or `Blob`; a listed file is
  read through `plugin/request-file` and the normal read checks.
- Reserved entries (`/exo.json`, `/.exo/**`) are filtered through the
  plugin-scoped workspace facade and re-checked before a page is served. They are
  never listed, returned, cached as an entry or accepted as a requested
  directory.
- An invalid cursor is `not-found`, including a malformed cursor, a cursor for a
  different path, an evicted snapshot and a cursor from another handler. The
  plugin lists again without a cursor.
- A missing directory is `not-found`; a file path is `not-a-directory`;
  `internal` covers an unexpected provider failure. A protocol-violation reply
  covers a missing `id`, a non-string `path`, a non-string `cursor` or an unknown
  field.
- At most four listing requests per frame may be in flight, and a frame may send
  at most twenty listing requests in a rolling second. Exceeding either limit
  returns `rate-limited` without queueing or performing the listing. A page has a
  five-second deadline and returns `timeout` with no partial entries.
- Listing snapshots are handler-scoped and workspace-scoped. They are discarded
  and pending pages are aborted on handler disposal, tab close, plugin removal and
  workspace switch; a page that resolves late is dropped and produces no
  `shell/list-result`. The cache is bounded per handler with LRU eviction; the
  newest snapshot is always admitted so a large directory is never silently
  truncated.
- Listing is not a watcher and grants no write. A hidden handler may list if it
  holds the permission; no visible surface or user gesture is required.

### 5.3 Dirty state and save

```text
plugin/dirty          { dirty: boolean }
plugin/request-save   { }                      // plugin-initiated, id-less
shell/request-save    { }                      // shell-initiated, has id
plugin/save-content   { text } | { bytes: ArrayBuffer }
shell/save-result     { ok: true, version } | { ok: false, code, message? }
```

- `plugin/dirty` is advisory but required for the tab dot and the close prompt.
  The shell tracks the last reported value; a handler that never reports is
  treated as clean.
- The plugin may ask the shell to save with `plugin/request-save`. It is an
  intent, not a request: no `id`, no content and no version. The shell starts the
  same save as its Save action, so the content still arrives only as the answer
  to `shell/request-save`. A trigger during an in-flight save is coalesced; a
  trigger for a clean, read-only or inactive document is ignored. Pressing Save
  twice must not produce two writes.
- The shell may request a save at any time while the session is alive. It sends
  one `shell/request-save` at a time and queues at most one additional request.
- The plugin answers within 5 s or the save fails with `timeout`. `save-content`
  must carry `replyTo` for the live request; unsolicited content is ignored and
  never written (section 3.3).
- `shell/save-result` echoes the request's `id` in `replyTo`.
- The shell writes with `ifVersion` set to the version it last delivered in
  `shell/init` or `file-content`. A `conflict` result means the file changed
  underneath; the shell reports it and leaves the tab dirty. The plugin may
  re-request the file and retry.
- A save requires `workspace:write` and a writable workspace session. The shell
  offers no save action for a read-only editor or a read-only workspace, and
  answers any save attempt with `permission-denied` without writing; the document
  stays dirty.
- On success the shell updates the tab's base version, clears dirty state only if
  the plugin has not reported dirty again in the meantime, and emits
  `workspace/file-changed` with kind `changed`.

### 5.4 External changes

```text
shell/file-changed    { path, kind: 'changed' | 'deleted' | 'renamed', version? }
```

Sent when the shell observes a change to the open file (poll on focus, or the
provider's watcher). This is the immediate, targeted notification for the bound
document; it is not a topic subscription event and does not require
`events:subscribe`. The same observation also feeds the coalesced
`workspace/file-changed` topic for subscribed frames
([`events.md`](./events.md#4-topic-catalog-v1)). `version` is present for
`changed` and `renamed`, absent for `deleted`. The plugin decides whether to
reload, keep its buffer, or ask the user. The shell does not auto-reload a dirty
tab. A save after deletion fails with `not-found` and does not recreate the
file.

### 5.4.1 Plugin-local events

```text
plugin/publish       { topic: 'local/<name>', payload: unknown }   // correlated
shell/published      { topic: 'local/<name>', seq: number }        // replyTo = request id
```

- `plugin/publish` is an editor-phase, correlated request. It requires
  `events:subscribe`. The topic must be a well-formed `local/<name>`; a shell
  catalog topic is rejected with `permission-denied`, another malformed name with
  `unsupported-topic`, a payload over 1 MiB with `too-large`, and an excess rate
  with `rate-limited`. The shell does not interpret, log or persist the payload.
- The shell sets `from` on the resulting `shell/event` to the publishing frame's
  opaque `exo-session`. Delivery is limited to subscribed handler frames of the
  same plugin identity and is at-most-once with no replay. A publisher that also
  subscribed receives its own event.
- `shell/published` means the shell accepted the event, not that a peer handled
  it. A publish from a disposed frame is dropped with no reply.
- The shell reserves `local/` for this purpose. The shell topic catalog stays
  closed; a plugin cannot publish `theme/changed` or any other shell topic.
- A frame may publish at most 200 local events per rolling second across all
  local topics and 100 per second on one topic. The limits are in
  [`events.md`](./events.md#6-limits-and-failure).

### 5.5 View session

Panels and content views use `exo-mode=view` and the same handshake, sandbox,
origin checks, settings, read/list/picker/events path and disposal as a handler.
They have no file block, dirty state or save path.

```text
shell/init (view) {
  mode: 'view',
  view: { kind: 'panel' | 'content', id, title, instanceId, location?, payload?, openedBy? },
  capabilities, limits
}
```

- A panel is a singleton frame, mounted on first reveal and retained hidden while
  another primary or secondary view is active. A never-revealed panel creates no
  iframe.
- A content view is one frame per open tab instance. The tab id is derived from
  the plugin identity, view id and instance key. Opening an existing instance key
  focuses its tab and ignores a new payload.
- The view block never contains a file path, bytes, `File`, `Blob` or handle.
  `payload` is structured-cloneable data of at most 64 KiB and is passed only in
  `shell/init`; it is never put in the frame URL or the log. `openedBy` is advisory
  display data added by the shell, not the caller.
- A view frame can subscribe to shell topics and publish local topics under the
  same identity, permission, sequence and queue rules as an editor frame. It can
  read files, list directories and open the picker only through the normal
  mediated path; it has no save or dirty method.
- Closing a content tab disposes its frame with reason `closed`. Plugin stop,
  revocation and workspace switch dispose every panel and content frame before
  the registrations and session are released.

### 5.6 Navigation and panel intents

```text
plugin/open-file      { path }                                  // correlated
plugin/open-view      { pluginId?, viewId, instanceKey?, payload? }
plugin/request-panel  { panel, action: 'show' | 'hide' | 'toggle' }
shell/open-result     { ok: true }                              // replyTo = request id
shell/panel-result    { panel, open: boolean }
```

- Intents are accepted in the editor and view phases, never in the registration
  phase. Each carries an `id`; the shell replies with the correlated result or
  `shell/error` with `replyTo`.
- The frame must be visible and active. A hidden document tab, a hidden panel or
  a content tab that is not active receives `permission-denied` and no action
  happens.
- `open-file` requires `workspace:read`. An editor resolves a relative path
  against its document; a view must use a `/`-rooted path. Reserved paths
  (`/exo.json`, `/.exo/**`) are denied after normalization. The shell checks that
  the target exists and is a file, and caps plugin-initiated open file tabs at 50
  per workspace.
- `open-view` without `pluginId` targets the caller's own plugin. With it, the
  shell resolves the active plugin with that id and passes `openedBy` to the
  target. An unknown plugin or unregistered view is `not-found`. The payload is
  limited to 64 KiB JSON; an oversized payload is `too-large` and opens nothing.
  There is no reverse channel: the opener receives only `shell/open-result`.
- `request-panel` only addresses the caller's own registered panels. `show`
  reveals and lazily mounts the panel, `hide` closes the region only when that
  panel is active, and `toggle` switches it. The result carries the panel id and
  its resulting open state; an unregistered panel is `not-found`.
- Each frame is limited to ten intents in a rolling second. Excess requests are
  `rate-limited`, not a teardown. A malformed intent is a protocol violation.

### 5.6.1 Commands

```text
shell/command          { command: string, args?: { path: string, kind: 'file' | 'directory' } }
                       // carries an id; the plugin answers with replyTo = that id
plugin/command-result  { ok: true } | { ok: false, message?: string }
```

- The shell sends `shell/command` only to a live, active frame of the same plugin
  identity that owns the command's target: the active document handler, a
  revealed panel or an opened content-view tab. The registration frame never
  receives one.
- `args` is present only for an explorer context invocation and carries the
  selected entry's normalized path and `file`/`directory` kind. Palette and
  editor-title invocations carry no arguments. No file content, handle, `File` or
  `Blob` is ever attached.
- The plugin answers with exactly one `plugin/command-result` whose `replyTo` is
  the invocation id. `ok: false` may carry a plain-text message of at most 200
  characters; the shell truncates longer text for display and logging. A second
  result, a result after the ten-second timeout and a result after disposal are
  ignored and logged.
- A `plugin/command-result` in the registration phase, or without a matching live
  invocation in the editor or view phase, is a protocol violation or an ignored
  late result respectively.
- The shell allows one in-flight invocation per command, five concurrent
  invocations per plugin and a five-second cooldown per command. An invocation
  over a limit is `rate-limited` in the plugin log and delivers nothing.

### 5.7 Disposal

```text
shell/dispose         { reason: 'closed' | 'workspace-switch' | 'plugin-removed' | 'error' }
plugin/dispose-ack    { }
```

- The shell waits 1 s for `plugin/dispose-ack`, then removes the iframe.
- After `shell/dispose` the shell accepts no further messages from that frame.
- Disposal is idempotent. Closing a tab while a save is in flight cancels the
  save and disposes.
- On workspace switch, handler frames are disposed before the workspace session
  is released.

## 6. Errors

```ts
interface ShellError {
  code:
    | 'unsupported-message'
    | 'unsupported-version'
    | 'protocol-violation'
    | 'timeout'
    | 'loading-failed'
    | 'permission-denied'
    | 'not-found'
    | 'not-a-file'
    | 'not-a-directory'
    | 'too-large'
    | 'conflict'
    | 'rate-limited'
    | 'unsupported-topic'
    | 'internal'
  message?: string // user-safe, no paths outside the requested scope
}
```

`shell/error` without `replyTo` refers to the plugin's last uncorrelated message.
Errors are also surfaced in the shell's plugin log for the current workspace and
are cleared on workspace switch.

## 7. Limits

| Limit | Value |
| --- | --- |
| In-flight requests per frame | 64 |
| Message payload | 16 MiB |
| Single file read | `limits.maxRequestBytes` from `shell/init`, default 16 MiB |
| Manifest size | 256 KiB |
| Ready timeout | 10 s |
| Registration timeout | 10 s |
| Save response timeout | 5 s |
| Dispose acknowledgement | 1 s |
| Command result timeout | 10 s |
| Concurrent command invocations per plugin | 5 |
| Command cooldown | 5 s |
| Commands per manifest | 32 |
| Command result message | 200 characters |
| Protocol violations before teardown | 3 |
| Frames per plugin per workspace | 1 registration + 1 per open document (max 20) + 1 per mounted panel (max 8) + 1 per open content-view tab (max 10) |
| Content-view payload | 64 KiB |
| Plugin-initiated open file tabs | 50 per workspace |
| Navigation and panel intents | 10 per rolling second per frame |
| Pending file pickers per frame | 1 |
| Open file pickers per shell | 1 |
| Paths per file selection | 32 |
| Entries per listing page | 1,000 |
| In-flight listing requests per frame | 4 |
| Listing requests per rolling second per frame | 20 |
| Listing page timeout | 5 s |
| Listing snapshots per handler | bounded with LRU eviction; the newest snapshot is always admitted |
| Local event payload | 1 MiB |
| Local publish rate per identity and topic | 100 events per rolling second |
| Local publish rate per frame | 200 events per rolling second across all local topics |
| Local topics per frame | included in the 32-topic subscription budget |

When a plugin already has 20 handler frames open, the shell refrains from mounting
another one: the new document opens in the shell's fallback renderer with a
notice, and the plugin receives no message about it. This keeps a runaway plugin
from exhausting memory without silently changing which editor is used. Panels and
content views are capped separately: an 11th content-view tab is `rate-limited`,
and a panel that cannot mount shows an inline unavailable state instead of a new
iframe. Plugin-initiated `open-file` requests over 50 open file tabs are
`rate-limited` with a message.

Exceeding a limit produces `shell/error` with `too-large` or `rate-limited` and,
for repeated violations, tears down the frame.

## 8. Versioning

- `protocolVersion` is a string major (`"1"`). The shell accepts exactly one
  major per release. A plugin that reports a different major receives
  `shell/error` `unsupported-version` and is unloaded before any registration.
- Additive optional fields and additive message types are allowed within a major.
  Removed or reinterpreted fields require a new major and a new OpenSpec change.
  A shell that predates an additive notification ignores it; the plugin must keep
  a working fallback (for `plugin/request-save`, the shell Save action).
- The `view` mode, the `view` init block, the navigation/panel intents, the
  command messages and the extra registration fields are additive within protocol
  major `1`. An older shell rejects a manifest that declares
  `contributes.panels`, `contributes.contentViews` or `contributes.commands`
  unless `engines.exo` excludes that shell, so the plugin fails closed with
  `incompatible-engine` rather than a partial surface.
- The SDK exposes the protocol version as a constant so plugins do not hard-code
  it. The SDK major tracks the protocol major; its compatibility and deprecation
  policy is in [`plugin-sdk.md`](./plugin-sdk.md#9-compatibility-and-deprecation-policy).
- `shell/init` advertises `shell.version`; plugins must not infer capabilities
  from it, only log it.
- The release checklist, communication policy and upgrade-note requirement for a
  breaking change are in [`releases.md`](../releases.md).

## 9. Security checklist for the host implementation

- Validate `event.origin` and `event.source` before parsing the payload.
- Never send `file-content` for a path the frame did not request with a live id.
- Never return a picker path the user did not select, and never return a reserved
  path; re-check the reserved set immediately before the reply.
- Close a picker without a reply when its handler is disposed, hidden, inactive
  or belongs to a released workspace.
- Never pass `FileSystemHandle`, `File`, or `Blob` objects to a frame.
- List only through the plugin-scoped facade, re-check the reserved set for every
  entry before it enters a page or snapshot, and never cache a reserved path or
  accept one as a listing directory.
- Validate `workspace:list` at the handler boundary, reject foreign or mismatched
  cursors, and drop listing pages that resolve after disposal or a workspace
  switch.
- Return only `path`, `kind` and, for files, `size` from a listing; never `mtime`,
  a content version, content or a handle.
- Never include another document's path in an error message.
- Re-check `workspace:read` and `workspace:write` at the handler boundary; a
  registry entry is not a capability.
- Normalize every path before the reserved-path and containment checks; check
  after resolution, not before.
- Drop messages after `shell/dispose` even if the frame is still alive.
- Mount panel and content-view frames with the same sandbox, origin, source,
  target-origin and size checks as handler frames; never send a `file` block to a
  view frame.
- Treat a content-view payload as opaque data: enforce the 64 KiB limit, never put
  it in a URL, never log it and never forward it to another frame.
- Gate every navigation and panel intent on the frame being active and visible,
  re-check `workspace:read` for `open-file`, reject reserved paths after
  normalization and accept `request-panel` only for the caller's own registered
  panel.
- Name the plugin in the activity-bar title, secondary picker and content-view
  chrome; never render plugin-supplied HTML in shell chrome.
- Do not log file contents. Log ids, paths, topics and error codes; a local
  event payload is opaque and is never logged.
- A same-origin plugin entry must never receive `allow-same-origin` (D3, D9).
