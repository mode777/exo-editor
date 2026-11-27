# Security review - v1 release

Status: review in progress for the `release-readiness` change. The final date,
deployed commit and scan result are recorded in
[Release evidence](#release-evidence) after the deployed verification.

Scope: the shell, the plugin host and protocol, the workspace session and its
providers, the deployed static artifact, and the shell-owned credential path.
Threat model: a plugin is an untrusted web page; the shell is the only code that
touches the user's filesystem, consent store or remote credential.

Method: each control is mapped to the requirement that owns it, the code that
enforces it and the tests that fail when it is removed. Every row was
mutation-checked by weakening the check locally, running the named test and
reverting. Findings are recorded in [Findings](#findings).

## Control inventory

| # | Control | Requirement | Enforcement | Regression tests |
| --- | --- | --- | --- | --- |
| 1 | Origin and source validation | `plugin-protocol` - Validated envelope; `plugin-host` - Deterministic initialization and plugin identity | `plugins/protocol.ts` (`parseEnvelope`), `plugins/registration.ts` and `plugins/handler.ts` message gates | `registration.test.ts`, `handler.test.ts`, `sdk-conformance.test.ts` |
| 2 | Consent before code | `plugin-manifest` - Consent gates code loading; `plugin-host` - Consent queue | `plugins/host.ts` (consent decision before `RegistrationSession.start()`), `plugins/consent.ts` | `host.test.ts`, `consent.test.ts`, `App.consent.test.tsx` |
| 3 | Sandbox by origin | `editor-shell` - No editor is privileged; `plugin-host` - Workspace-scoped host lifecycle | `plugins/protocol.ts` (`frameBoundary`), `plugins/frame.ts` (sandbox set before source) | `frame.test.ts`, `registration.test.ts`, `handler.test.ts` |
| 4 | Path containment | `workspace-access` - Path normalization and containment | `workspace/paths.ts` (`normalizePath`), `workspace/session.ts` (re-normalizes every actor path) | `paths.test.ts`, `session.test.ts`, `handler.test.ts` |
| 5 | Reserved paths | `workspace-access` - Reserved paths; `editor-shell` - Workspace configuration is shell-only | `workspace/session.ts` plugin guard, `workspace/paths.ts` (`isReservedPath`, `filterReserved`) | `paths.test.ts`, `session.test.ts`, `handler.test.ts`, `store.test.ts` |
| 6 | Content security policy | `editor-shell` - Shell content security policy | `src/csp.ts`, `index.html` build transform, `scripts/check-dist-csp.mjs` | `csp.test.ts`, `check:dist-csp` |
| 7 | Payload and size limits | `plugin-protocol` - Limits and protocol versioning; Mediated reads | `plugins/protocol.ts` (`MAX_MESSAGE_BYTES`, `payloadTooLarge`), `plugins/handler.ts` (request cap, file cap), `plugins/events.ts` (queue cap) | `protocol.test.ts` (new), `handler.test.ts`, `events.test.ts`, `manifest.test.ts` |
| 8 | Consent fingerprint | `plugin-manifest` - Consent fingerprint | `plugins/consent.ts` (`fingerprintInput`, `computeFingerprint`), `plugins/host.ts` (compare before activation) | `consent.test.ts`, `host.test.ts` |
| 9 | Shell-owned credentials | `remote-workspace` - Shell-owned credential; No remote URL capabilities | `workspace/providers/stratofold/connection-store.ts`, `workspace/runtime.ts` (`summaryOf` and the `ConnectionStore` boundary) | `runtime.remote.test.ts`, `App.remote.test.tsx`, `connection-store.test.ts` |
| 10 | Secret-free delivery | `editor-shell` - Static, backend-free delivery | `scripts/check-dist-secrets.mjs` (new), CI after the child-path copies | `scripts/check-dist-secrets.test.mjs` (new), `check:dist-secrets` |
| 11 | User-mediated file picker | `plugin-protocol` - File picker request; `plugin-file-editors` - User-mediated file selection | `plugins/file-picker.ts`, `plugins/handler.ts` (active/visible/focused gate, reserved-path re-check), `document/FilePickerDialog.tsx` | `handler.test.ts`, `handlers.test.ts`, `file-picker.test.ts`, `FilePickerDialog.test.tsx`, `sdk-conformance.test.ts` |
| 12 | Plugin-local event isolation | `plugin-events` - Plugin-local topic namespace; Delivery semantics; Limits and failure isolation | `plugins/events.ts` (identity filter, per-identity sequences, per-frame rate), `plugins/handler.ts` (`plugin/publish` validation) | `events.test.ts`, `handler.test.ts`, `registration.test.ts`, `sdk-conformance.test.ts` |
| 13 | View surfaces and navigation intents | `plugin-views` - Panel contributions; Content-view contributions; Navigation and panel intents; Cross-plugin content views; View lifecycle | `plugins/frame-session.ts` (shared gate, path and intent checks), `plugins/view-session.ts`, `plugins/view-pool.ts` (lazy mount, caps, surfaces), `workspace/runtime.ts` (open-file/view/panel resolution) | `view-session.test.ts`, `view-pool.test.ts`, `runtime.views.test.ts`, `plugin-views.test.tsx`, `ContentViewSurface.test.tsx`, `SecondaryViewPicker.test.tsx` |
| 14 | Plugin command surface | `plugin-commands` - Command contribution semantics; Command registration activation; Command invocation; Command results and failures; Command runtime limits; Command attribution and isolation; Command teardown | `plugins/commands.ts` (registry, single controller, target resolution, timers, limits, notices), `plugins/frame-session.ts` (`shell/command` delivery, active-phase result routing, init support bit), `plugins/registration.ts` (subset, dedupe, `target-not-registered`), `workbench/commands.ts` (synthetic palette ids), `explorer/ExplorerView.tsx`, `document/DocumentArea.tsx` | `commands.test.ts`, `registration.test.ts`, `host.test.ts`, `commands.test.ts` (palette), `ExplorerView.commands.test.tsx`, `DocumentArea.commands.test.tsx`, `CommandNotices.test.tsx` |
| 15 | New-file creation | `plugin-file-creation` all requirements; `workspace-access` - Create-only writes; Create-only provider parity; `plugin-protocol` - New-file creation request; New-file capability negotiation; Limits; `editor-shell` - Explorer new-file templates; New-file Save As dialog; `plugin-host` - New-file template registration | `plugins/new-file.ts` (single dialog, create-only write, cancellation, reset), `plugins/frame-session.ts` (shape, permission, focus, size and rate gates, correlated result), `plugins/manifest.ts` (decoded limits, reserved names), `plugins/registration.ts` (declared id, `workspace:write`), `workspace/providers/*` (`createOnly`), `document/NewFileDialog.tsx`, `explorer/ExplorerView.tsx` | `new-file.test.ts`, `handler.test.ts`, `NewFileDialog.test.tsx`, `manifest.test.ts`, `registration.test.ts`, `host.test.ts`, `conformance.ts`, `consent.test.ts`, `ExplorerView.commands.test.tsx`, `new-file.test.ts` (SDK) |
| 16 | Editor-bound panels | `plugin-views` - Active editor context; Panel contributions; Panel registration and lazy mounting; `plugin-events` - V1 topic catalog; Delivery semantics; Change producers; `plugin-protocol` - View frame initialization; View and intent capability negotiation; Bottom panel capability negotiation; `editor-shell` - Plugin bottom panels; Active editor tracking in the workbench | `plugins/view-pool.ts` (identity filter, bottom location), `plugins/view-session.ts` (activeEditor init), `workspace/runtime.ts` (active editor derivation and targeted publish), `plugins/frame-session.ts` (editorContext bit), `plugins/handler.ts` (instanceId), `workbench/plugin-views.tsx` (active-tab-only bottom placeholder), `plugins/consent.ts` (fingerprint unchanged) | `runtime.editor-context.test.ts`, `view-pool.test.ts`, `view-session.test.ts`, `handler.test.ts`, `events.test.ts`, `plugin-views.test.tsx`, `sdk-conformance.test.ts`, `consent.test.ts`, `manifest.test.ts` |
| 17 | Marketplace catalog and installation | `plugin-marketplace` all requirements; `editor-shell` - Plugin configuration settings surface; `plugin-manifest` - Canonical configuration rewrite | `marketplace/feed.ts` (strict parser, URL normalization, limits), `marketplace/store.ts` (credentials omitted, no referrer, timeout, byte caps, no persistence), `extensions/ExtensionsView.tsx` (escaped text, user action, disabled states), `plugins/management.ts` (URL lookup, dirty guard, config store only), `plugins/host.ts` (normal manifest and consent path), `scripts/deploy-marketplace.mjs`, `scripts/check-marketplace.mjs` | `feed.test.ts`, `store.test.ts`, `management.test.ts`, `management.integration.test.ts`, `ExtensionsView.test.tsx`, `marketplace.test.ts`, `dist-secrets-guard.test.ts`, `check:marketplace` |

## Control details

### 1. Origin and source validation

- Requirements: `plugin-protocol` "Validated envelope"; `plugin-host`
  "Deterministic initialization and plugin identity".
- Enforcement: `parseEnvelope` rejects non-objects, a missing `exo: 1`, an empty
  type and over-long ids. Both session state machines drop a message whose
  `source` is not the registered frame window, then require `origin === "null"`
  for an opaque same-origin frame and exact manifest origin otherwise. A
  violation is counted and three close the frame.
- Tests: `registration.test.ts` "drops messages from a foreign source without a
  state change", "drops a foreign origin and tears down after three violations";
  `handler.test.ts` "rejects a wrong session echo and a foreign origin";
  `sdk-conformance.test.ts` "ignores a spoofed init and accepts the real one",
  "rejects a spoofed session without changing shell state",
  "rejects a wrong-mode init without changing shell state".
- Mutation: replace the `message.source !== this.frame.window` guard and the
  origin checks with `false`. Result: `registration.test.ts` "drops messages
  from a foreign source without a state change" and "drops a foreign origin and
  tears down after three violations" both fail.

### 2. Consent before code

- Requirements: `plugin-manifest` "Consent gates code loading"; `plugin-host`
  "Consent queue".
- Enforcement: `PluginHost` computes the fingerprint, checks the persisted
  record, and only calls `beginRegistration` for a granted record. A pending
  record stays `awaiting-consent` and no `RegistrationSession` or iframe exists.
- Tests: `host.test.ts` "loads a manifest, requests consent and activates a
  registered editor", "denies without mounting a frame and can be reviewed
  manually", "queues consent in declaration order and advances after a decision";
  `App.consent.test.tsx` "denies without mounting a frame and records the
  decision in settings".
- Mutation: make the consent `else` branch push every record into `granted`.
  Result: `host.test.ts` "loads a manifest, requests consent and activates a
  registered editor" and `App.consent.test.tsx` "denies without mounting a frame
  and records the decision in settings" both fail.

### 3. Sandbox by origin

- Requirements: `editor-shell` "No editor is privileged"; `plugin-host`
  "Workspace-scoped host lifecycle".
- Enforcement: `frameBoundary` selects `allow-scripts` for a same-origin
  (opaque) frame and `allow-scripts allow-same-origin` for a cross-origin frame;
  `DomFrameTransport` sets the sandbox attribute before assigning `src`.
- Tests: `frame.test.ts` "creates a hidden frame with the sandbox set before the
  source"; `registration.test.ts` "mounts the controller with the register
  fragment and cross-origin sandbox", "uses the stricter sandbox and wildcard
  target for an opaque same-origin frame"; `handler.test.ts` equivalents.
- Mutation: make `frameBoundary` always return
  `allow-scripts allow-same-origin`. Result: `registration.test.ts` and
  `handler.test.ts` "uses the stricter sandbox and wildcard target for an opaque
  same-origin frame" fail.

### 4. Path containment

- Requirements: `workspace-access` "Path normalization and containment".
- Enforcement: `normalizePath` rejects relative paths, `..`/`.`, empty
  segments, backslashes, NUL, control characters and over-long paths instead of
  repairing them; `Session` re-normalizes every path for every actor and rejects
  a plugin path outside its facade root.
- Tests: `paths.test.ts` "rejects %s (%s)" (including parent traversal and
  backslash), "maps every rejection to permission-denied"; `session.test.ts`
  caller-scoped tests; `handler.test.ts` "denies paths that leave the
  workspace".
- Mutation: remove the `segment === '..'` rejection. Result: `paths.test.ts`
  "rejects /a/../b (parent traversal)" fails.

### 5. Reserved paths

- Requirements: `workspace-access` "Reserved paths"; `editor-shell` "Workspace
  configuration is shell-only".
- Enforcement: `Session` denies every plugin operation whose path is
  `isReservedPath`, and filters reserved entries from plugin listings; shell
  actors keep access so the Extensions management surface and the settings raw
  editor can read and rewrite `exo.json`.
- Tests: `paths.test.ts` "reserves the configuration file and metadata
  directory", "filters reserved entries out of listings"; `session.test.ts`
  "lets the shell read reserved paths while a plugin facade is denied", "denies
  every plugin mutation on reserved paths", "hides reserved entries from a
  plugin root listing"; `handler.test.ts` "denies reserved paths without reading
  them".
- Mutation: remove the session guard only. Result: `session.test.ts` "denies
  every plugin mutation on reserved paths" fails. Removing the handler read
  guard alone is contained by the session facade, which is defense in depth;
  removing both makes `handler.test.ts` "denies reserved paths without reading
  them" fail.

### 6. Content security policy

- Requirements: `editor-shell` "Shell content security policy".
- Enforcement: `CSP_DIRECTIVES` allows `frame-src https: http://localhost:*`,
  `connect-src 'self' https: http://localhost:*` and `script-src 'self'`, with no
  `unsafe-eval`, `unsafe-inline`, `default-src` or `style-src`;
  `exoCspPlugin` injects it at build time and the dist check verifies the built
  document.
- Tests: `csp.test.ts` (ratified directives, localhost-only plain HTTP, no
  evaluation/inline, no default/style directive), `check:dist-csp` on the build.
- Mutation: add `'unsafe-inline'` to `script-src`. Result: `csp.test.ts`
  "never allows dynamic evaluation or inline scripts" fails.

### 7. Payload and size limits

- Requirements: `plugin-protocol` "Limits and protocol versioning" and
  "On-demand mediated reads"; `plugin-file-editors` "Mediated reads only".
- Enforcement: `MAX_MESSAGE_BYTES` is 16 MiB and `payloadTooLarge` walks the
  payload with a byte budget; handler reads cap in-flight requests at 64 and
  enforce the advertised per-file cap; the event bus caps its queue and drops
  payloads over 1 MiB.
- Tests: `protocol.test.ts` (new: cap boundary and nested payloads),
  `handler.test.ts` "denies a directory and an oversized file",
  `events.test.ts` "drops payloads over 1 MiB", "caps the queue...",
  `manifest.test.ts` size rejections.
- Mutation: make `payloadTooLarge` always return `false`. Result:
  `protocol.test.ts` fails on its over-cap cases and `registration.test.ts`
  "rejects an envelope over the message byte cap before reading it" fails.
  Before this change no test exercised the 16 MiB envelope cap, so the mutation
  survived; those two tests are the regression guard.

### 8. Consent fingerprint

- Requirements: `plugin-manifest` "Consent fingerprint".
- Enforcement: `fingerprintInput` canonicalizes origin, id, permissions, globs,
  priorities and frame rendering (not display metadata or page paths);
  `computeFingerprint` hashes it as `v1:<hex>`; `PluginHost` re-prompts when the
  stored fingerprint differs.
- Tests: `consent.test.ts` "uses the contract input order", "ignores display
  metadata and page paths", "includes frame rendering but not hidden rendering",
  "changes on every capability field", "formats a versioned lowercase hex
  digest"; `host.test.ts` "skips the prompt when a matching fingerprint is
  persisted", "re-prompts when a capability fingerprint widens".
- Mutation: empty the permissions list in `fingerprintInput`. Result:
  `consent.test.ts` "changes on every capability field" fails.

### 9. Shell-owned credentials

- Requirements: `remote-workspace` "Shell-owned credential" and "No remote URL
  capabilities".
- Enforcement: the token lives only in the Stratofold connection record in the
  shell-owned IndexedDB store; `RemoteWorkspaceSummary` is explicitly
  token-free; the connect dialog clears the raw connection string; request URLs
  carry no credential.
- Tests: `runtime.remote.test.ts` connection/persistence tests (including "stores
  a public connection without a credential"), `connection-store.test.ts`,
  `App.remote.test.tsx` "connects through the dialog without rendering the
  token", "shows the workspace section with connection details but no token",
  "lists a stored workspace, reopens it and never renders the token", "stores
  only the decomposed fields of a connection string".
- Mutation: add `token` to `summaryOf`. Result: `runtime.remote.test.ts` "never
  puts the token in the shell-facing remote snapshot" fails. That test was added
  by this review because the existing App assertions only checked rendered text
  and would not catch a token added to the snapshot object.

### 10. Secret-free delivery

- Requirements: `editor-shell` "Static, backend-free delivery".
- Enforcement: `check-dist-secrets.mjs` scans the built site, including the
  template and code-plugin child paths, for private-key blocks and GitHub, AWS,
  OpenAI, Slack, Google and JWT-shaped credentials. The CI step runs after
  `deploy:copy-code`.
- Tests: `apps/shell/scripts/check-dist-secrets.test.mjs` writes a clean fixture
  and an injected credential, and asserts pass/fail; `check:dist-secrets` runs on
  the real build.
- Mutation: inject `ghp_` plus 36 characters into a built asset. Result:
  `check-dist-secrets.mjs` exits 1 and reports the file and `github-token`
  pattern; the clean build exits 0.

### 11. User-mediated file picker

- Requirements: `plugin-protocol` "File picker request", "File picker selection
  constraints" and "File picker concurrency and lifecycle"; `plugin-file-editors`
  "User-mediated file selection".
- Enforcement: the picker is a shell modal, not plugin HTML; it lists through
  `forPlugin(pluginId).list` so reserved entries stay hidden; it accepts only an
  active, visible, focused handler; it returns only `/`-rooted paths, with no
  content or handles; the handler re-checks reserved paths and caps a selection
  at 32; disposal, tab switch or close, plugin removal and workspace switch abort
  the pending dialog without a reply.
- Tests: `handler.test.ts` "answers a file picker request with paths only",
  "rejects reserved, traversal and oversized picker results before replying",
  "denies the picker without workspace read", "rejects malformed picker payloads
  and unknown fields", "rate-limits a second picker request in the same frame"
  and "drops a picker continuation after disposal"; `handlers.test.ts` "opens a
  picker only for an active visible focused handler", "denies a picker from a
  hidden handler", "closes a picker silently on tab close and plugin removal"
  and "closes a picker silently when the document surface detaches";
  `file-picker.test.ts` abort and reset cases; `FilePickerDialog.test.tsx`
  reserved filtering, disclosure, focus and Escape; `sdk-conformance.test.ts`
  exercises the message through the real `HandlerSession` and SDK.
- Mutation: remove the final `isReservedPath` check in
  `HandlerSession.handleRequestFiles`. Result: `handler.test.ts` "rejects
  reserved, traversal and oversized picker results before replying" fails.
  Remove the `surfaces`/`hasFocus` gate in `HandlerPool`. Result:
  `handlers.test.ts` "opens a picker only for an active visible focused handler"
  and "denies a picker from a hidden handler" fail.

### 12. Plugin-local event isolation

- Requirements: `plugin-events` "Plugin-local topic namespace", "Delivery
  semantics", "Limits and failure isolation"; `plugin-protocol` "Plugin-local
  publication message".
- Enforcement: `EventBus.publishLocal` rejects a non-`local/` topic, scopes
  sequences by `(identity, topic)` and filters delivery on
  `subscriber.sink.identity === identity`. The shell sets `from` from the handler
  session id, never from the payload. `HandlerSession.handlePublish` requires
  `events:subscribe`, a live id and a well-formed topic, enforces the 1 MiB
  payload and 200/s frame rate, and logs the topic but not the payload.
  Registration frames reject `plugin/publish` as a protocol violation.
- Tests: `events.test.ts` "delivers only to the publishing plugin and carries the
  frame session", "sequences per plugin identity and does not replay", "limits
  one frame to 200 local events per second across topics" and "caps the local
  queue per subscriber and reports overflow once"; `handler.test.ts` "publishes
  a local event, acknowledges it and delivers it to the publisher", "rejects a
  shell topic publication without changing its sequence", "explains an oversized
  local payload", "treats a publish without an id as a protocol violation" and
  "drops a publish after disposal without acknowledging it";
  `registration.test.ts` "rejects a local publish from the registration frame as
  a violation"; `sdk-conformance.test.ts` "exchanges local events between two
  real handler frames and isolates another plugin".
- Mutation: remove the `subscriber.sink.identity !== identity` filter in
  `EventBus.publishLocal`. Result: `events.test.ts` "delivers only to the
  publishing plugin and carries the frame session" fails because the second
  plugin's subscriber receives the event. Removing the shell-topic guard makes
  "rejects a shell topic publication without changing its sequence" fail.

### 13. View surfaces and navigation intents

- Requirements: `plugin-views` "Panel contributions", "Content-view
  contributions and instances", "Navigation and panel intents", "Cross-plugin
  content views", "View lifecycle and failure isolation"; `plugin-protocol` "View
  frame bootstrap and handshake", "View navigation intents"; `plugin-manifest`
  section 3.2.
- Enforcement: `FrameSession` applies the same origin/source, payload-size,
  protocol-violation and disposal rules to view frames; `ViewSession` adds only
  the view block and rejects editor-only messages; `ViewPool` caps panels and
  content tabs and positions frames only over shell-owned placeholders;
  `plugin/open-file`, `plugin/open-view` and `plugin/request-panel` require the
  frame to be visible and active, re-check `workspace:read` for files, reject
  reserved paths after normalization, cap content-view payloads at 64 KiB and
  accept panel requests only for the caller's own registered panels. A content
  view payload is one-shot data, never logged and never put in a URL. The
  activity-bar title, secondary picker and content-view chrome include the plugin
  name.
- Tests: `view-session.test.ts` "reads only absolute paths and returns text",
  "opens files through the intent with read and visibility gates", "opens a view
  and rejects an oversized payload", "requests a panel and returns its resulting
  state", "rejects the eleventh intent in one rolling second",
  "treats editor-only messages as protocol violations", "disposes with an
  acknowledgement and drops late messages"; `view-pool.test.ts` lazy mount,
  retain, content cap, close and detach; `runtime.views.test.ts` cross-plugin
  open and host teardown; `plugin-views.test.tsx` and `ContentViewSurface.test.tsx`
  for derived chrome and a11y; `SecondaryViewPicker.test.tsx` for keyboard and
  axe.
- Mutation: remove the `visible()` check from `FrameSession.handleOpenFile`.
  Result: `view-session.test.ts` "opens files through the intent with read and
  visibility gates" fails on the hidden-frame case. Remove the
  `MAX_VIEW_PAYLOAD_BYTES` check: "opens a view and rejects an oversized payload"
  fails. Remove the `isReservedPath` check: the reserved `/exo.json` intent case
  opens a tab and fails.

### 14. Plugin command surface

- Requirements: `plugin-commands` all requirements; `plugin-manifest` section
  3.3; `plugin-protocol` section 5.6.1; `plugin-host` "Command registry and
  teardown"; `editor-shell` "Plugin commands in shell surfaces".
- Enforcement: `CommandRegistry` accepts commands only after
  `plugin/register-complete` and re-keys them by plugin identity and registration
  order. Registration accepts only manifest-declared command ids, deduplicates
  repeats and rejects a view-target command whose target was not registered in
  the same session. `PluginCommandController` is the only path from a surface to
  a frame: it re-resolves the live command, enforces one in-flight invocation per
  command, five per plugin, the five-second cooldown and the ten-second timeout,
  and resolves the active editor by identity or reveals/opens the view target.
  `FrameSession.sendCommand` refuses a non-active frame; result routing accepts
  only the active phase and the controller matches `replyTo` against the live
  invocation. Arguments are shell-derived: `{ path, kind }` for explorer
  invocations, absent otherwise; no content, handle, `File` or `Blob` is
  attached. Palette ids are shell-owned and synthesized, so a plugin command
  cannot shadow a shell id. Every surface names the plugin. Workspace teardown
  clears the registry, controller timers, cooldowns, pending invocations and
  notices; a late result from a released frame finds no pending record.
- Tests: `commands.test.ts` covers registry ordering/removal, active-editor and
  lazy panel/content-view delivery, explorer arguments, single-flight, cooldown,
  concurrency, timeout, failure text, invalid and duplicate results, frame
  disposal, reset and the result parser; `registration.test.ts` covers subset,
  dedupe, undeclared ids, panel-first/command-first order and
  `target-not-registered`; `host.test.ts` covers completion gating and teardown;
  `workbench/commands.test.ts` covers synthetic ids and non-shadowing;
  `ExplorerView.commands.test.tsx` and `DocumentArea.commands.test.tsx` cover
  attribution, args, cap, keyboard Escape and axe; `CommandNotices.test.tsx`
  covers plain text, dismissal and auto-dismiss.
- Mutation: remove the `pending.has(key)` single-flight check: the
  "single-flight" expectation in `commands.test.ts` fails. Remove the
  `frameSession.phase !== 'active'` guard in `sendCommand`: the inactive-frame
  case delivers a message and fails. Remove the `target-not-registered` loop in
  `RegistrationSession.handleComplete`: the missing-target test accepts the
  command. Remove the identity comparison in `Runtime.activeEditorTarget`: the
  editor-action test for another plugin renders and fails. Remove
  `commands.reset()` from `WorkspaceRuntime.deactivate`: the workspace-reset test
  observes stale notices and fails.

### 15. New-file creation

- Requirements: `plugin-file-creation` all requirements; `workspace-access`
  "Create-only writes" and "Create-only provider parity"; `plugin-protocol`
  "New-file creation request", "New-file capability negotiation" and "Limits";
  `plugin-manifest` section 3.4; `editor-shell` "Explorer new-file templates" and
  "New-file Save As dialog"; `plugin-host` "New-file template registration".
- Enforcement: the manifest validator decodes base64 once, caps each template at
  64 KiB and the plugin at 128 KiB total, and rejects multi-segment or reserved
  default names. Registration accepts only declared ids and only with
  `workspace:write`; templates activate after `plugin/register-complete` and are
  removed with the plugin. A runtime request must be an active, visible, focused
  editor (`rendering: "frame"`) or view frame with `workspace:write` and a
  writable session. `FrameSession` requires exactly one content field, enforces
  the 8 MiB cap and a ten-per-second per-frame budget, and the controller allows
  one dialog per shell. The write goes through the plugin-scoped workspace facade
  with `createOnly: true`, so a reserved or existing target is refused and never
  truncated. The dialog is shell-owned: the plugin supplies only a validated name
  hint and content; it supplies no title, description or path. Cancellation,
  frame disposal, plugin removal and workspace switch close it without a write;
  a late result is dropped. Logs carry ids, paths and codes, never content.
- Tests: `new-file.test.ts` covers create-only success, binary bytes, collision,
  reserved names, a single dialog, cancellation, disposal, reset, hint fallback
  and the template/request open difference; `handler.test.ts` covers the
  request shape, size, permission, focus, cancellation, error and disposal
  paths; `manifest.test.ts` covers decoding, limits, names and duplicates;
  `registration.test.ts` and `host.test.ts` cover activation, permission,
  undeclared ids and teardown; `conformance.ts` covers `already-exists`,
  directory targets, parent creation and preserved content on all providers;
  `NewFileDialog.test.tsx` covers disclosure, focus, navigation, binary content
  and the collision state; `consent.test.ts` pins the fingerprint exclusion;
  `ExplorerView.commands.test.tsx` covers the grouped menu; the SDK
  `new-file.test.ts` covers text, bytes, cancellation, size, support, permission,
  pending and malformed-result paths.
- Mutation: remove the `createOnly` check in the memory provider: the
  conformance "creates only a missing target" assertion overwrites the existing
  file and fails. Remove `hasWorkspaceWrite` from the `plugin/request-new-file`
  gate: the read-only handler test opens a dialog and fails. Remove the
  `hasFocus` check: the hidden-frame case is accepted and fails. Remove the
  `MAX_NEW_FILE_BYTES` check: the oversized case reaches the handler and fails.
  Remove `newFiles.reset()` from `WorkspaceRuntime.deactivate`: the template
  remains offerable from the released workspace. Remove the fingerprint
  exclusion by adding `newFiles` to `fingerprintInput`: the consent exclusion
  test fails on a content change.

### 16. Editor-bound panels

- Requirements: `plugin-views` "Active editor context for view frames", "Panel
  contributions" and "Panel registration and lazy mounting"; `plugin-events`
  "V1 topic catalog", "Delivery semantics" and "Change producers";
  `plugin-protocol` "View frame initialization", "View and intent capability
  negotiation" and "Bottom panel capability negotiation"; `editor-shell` "Plugin
  bottom panels" and "Active editor tracking in the workbench".
- Enforcement: `ViewPool` filters `activeEditor` by the full plugin identity, not
  only the manifest id, so a same-id plugin on another origin receives `null`.
  `WorkspaceRuntime.syncActiveEditor` advertises only the active tab's active
  handler; text, content, failed, mounting, background and other-plugin surfaces
  clear it. The `editor/active` event uses `EventBus.publish` with the target
  identity, so another plugin receives neither the event nor the path. The value
  carries only `pluginId`, path and `instanceId`; no bytes, handle or save
  method. A bottom panel is added to the workbench `panel` registry, and
  `PanelSurface` renders its placeholder only when it is the resolved active
  bottom tab, so an inactive tab creates no iframe. A view frame still has no
  dirty/save path; the editor applies panel edits through its own history and
  saves normally. Consent is unchanged: bottom panels are user-invoked and the
  active editor is the plugin's own document metadata.
- Tests: `runtime.editor-context.test.ts` covers editor-to-editor, text,
  content, other-plugin, no-tab, rename and remount transitions;
  `view-pool.test.ts` covers the bottom location, identity filtering and the
  same-id different-origin case; `view-session.test.ts` covers the
  `activeEditor` init and metadata-only shape; `handler.test.ts` covers the
  per-frame instance id and `from` equality; `events.test.ts` covers targeted
  delivery and sequencing; `plugin-views.test.tsx` covers derived bottom tabs,
  active-only mounting, the first-tab fallback and an axe scan;
  `sdk-conformance.test.ts` drives a real view through the SDK and
  `consent.test.ts` pins the fingerprint exclusion.
- Mutation: remove the identity comparison in `ViewPool.mount`'s
  `activeEditor` callback: the same-id different-origin test receives the other
  plugin's context and fails. Remove `{ target: next.identity }` from the
  runtime publish: the cross-plugin `events.test.ts` case receives the event and
  fails. Remove `editor: { instanceId }` from `HandlerSession.buildModeInit`:
  the handler init test fails. Remove the `shown` guard in `PanelSurface`:
  `plugin-views.test.tsx` creates two frames for two tabs and fails.

### 17. Marketplace catalog and installation

- Requirements: `plugin-marketplace` "Deployment-scoped marketplace sources",
  "Marketplace feed format", "Feed loading and failure isolation", "Catalog
  discovery", "Install and manage in the current workspace", "Marketplace trust
  boundary" and "Official feed and deployment"; `editor-shell` "Plugin
  configuration settings surface"; `plugin-manifest` "Canonical configuration
  rewrite".
- Enforcement: `validateMarketplaceSources` and `validateMarketplaceFeed` reject
  unknown fields, invalid or credentialed URLs, duplicate manifests, future
  versions and every limit; the store fetches with `credentials: 'omit'`,
  `referrerPolicy: 'no-referrer'`, a 10-second timeout and bounded body reads,
  never creates a frame and never touches a workspace session. `ExtensionsView`
  renders feed strings as React text, validates install targets through the
  existing config store and requires an explicit click. `PluginManagement`
  writes only through `PluginConfigStore.addEntry`/`setEnabled`/`removeEntry`
  and maps by normalized manifest URL; the host's normal manifest validation and
  consent queue run after the write. No feed field reaches
  `fingerprintInput`, an iframe `src`, a shell command or `exo.json`.
- Tests: `feed.test.ts` covers unknown fields, future versions, URL and
  duplicate rejection, limits and hostile text; `store.test.ts` covers lazy
  loading, credentials/referrer, timeout, byte caps, CORS/network isolation,
  dedupe and dispose; `management.integration.test.ts` asserts one canonical
  write, no write in read-only/no-workspace/invalid/conflict cases and no frame
  before approval; `ExtensionsView.test.tsx` covers install, no-workspace and
  read-only disabled states, failed-source isolation, details, settings and
  axe; `marketplace.test.ts` keeps the official feed in sync with the shipped
  manifests; `dist-secrets-guard.test.ts` scans marketplace JSON.
- Mutation: remove `credentials: 'omit'` from the store fetch: the store test's
  request-options assertion fails. Remove the `canManage` disabled guard from
  the install actions: the no-workspace/read-only tests find enabled install
  buttons and fail. Make the feed parser accept unknown fields: `feed.test.ts`
  fails. Bypass `PluginConfigStore` in the install path: the integration test's
  canonical-file, conflict and consent-order assertions fail.

## Findings

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | low | The 16 MiB envelope cap had no direct regression test; payload overflow was only covered indirectly by event and file limits. | Resolved in this change by `protocol.test.ts` and the registration overflow test. |
| F2 | info | jsdom cannot evaluate CSS contrast, so contrast is covered by the token-pair test and the manual deployed check, not axe. | Accepted; documented in `docs/accessibility.md`. |
| F3 | info | The upstream workbench command palette and chrome are not Exo-owned and are excluded from automated axe scans. | Accepted; documented with rationale and owner in `docs/accessibility.md`. |
| F4 | critical (dependency) | `monaco-editor@0.57.0` pins `dompurify@3.4.15` (bundled in `apps/code-plugin`), which is affected by DOMPurify advisories including IN_PLACE node removal and `application/xhtml+xml` parsing. | Accepted with rationale and follow-up owner: Monaco uses the string/`RETURN_TRUSTED_TYPE` path, does not set `IN_PLACE` or `SAFE_FOR_TEMPLATES`, parses as `text/html`, and the editor renders workspace content as text, not as HTML. The code plugin runs in a sandboxed frame with no storage. Upgrade when `monaco-editor` bumps its pinned DOMPurify; re-check this row on every dependency update. |
| F5 | moderate (dev) | `npm audit` reports a `minimatch` ReDoS in the TypeScript ESLint dependency tree. | Accepted: development-only tooling, no runtime or deployed artifact, inputs are repository files rather than untrusted plugin data. Update with the next tooling bump. |
| F6 | low | Panels and content views are excluded from the consent fingerprint, so an already-approved plugin can add an activity-bar item, a side panel or a content-view tab without a new prompt. | Accepted by design: the surfaces are user-invoked, grant no autonomous data or file access, and every shell chrome surface names the plugin so a new surface cannot impersonate the shell. The first-grant prompt lists them and the security review tracks the mitigation; adding them to the fingerprint is a one-change follow-up with a single re-prompt if required later. |
| F7 | low | Commands are excluded from the consent fingerprint and a misleading title could imitate shell chrome or describe an action broadly. | Accepted by design: commands are user-invoked, run only in frames the user already approved with their existing permissions, grant no autonomous access and cannot use a shell command id. Every palette entry, explorer entry and editor action names the contributing plugin, the first-grant prompt lists each command with its target and placements, and the plugin log attributes every invocation. A future fingerprint inclusion is a one-change follow-up with a single re-prompt. |
| F8 | low | New-file templates are excluded from the consent fingerprint, so an approved plugin can change what a template writes without a new prompt. | Accepted by design: a template only writes content the user confirms in a shell-owned dialog, after seeing the size and a bounded preview; it grants no autonomous access. The first-grant prompt lists each label and default name, the plugin name is in the dialog, and content changes remain visible and editable. The residual folder and Stratofold check-to-write race requires an external writer and is documented in the provider notes. |
| F9 | low | A marketplace feed can display a misleading name, publisher, icon or description that differs from the manifest. | Accepted by design: the source list is deployment-controlled, the manifest value replaces feed metadata in installed and consent surfaces, the manifest URL and origin are always shown in details, and a feed cannot install or grant anything without a user action and consent. The catalog is discovery-only; no signature or reputation system is claimed. |

No open finding above accepted severity. There is no server, secret, account or
first-party API in the deployed artifact. The dependency audit result is part of
the release record:

```text
npm audit --omit=dev
2 vulnerabilities (1 low, 1 critical)
monaco-editor -> dompurify 3.4.15 (see F4)
```

The `overrides` field was tried and does not change Monaco's bundled copy; the
finding is tracked instead of pretending the artifact is clean.

## Release evidence

- Review date: 2026-11-16.
- Deployed commit: `90172af` (`Add Connect Remote Workspace to the File menu`),
  which contains the release-readiness commits and was deployed by the CI
  `verify` and Pages jobs at 2026-11-16.
- Mutation checks: all controls listed above fail at least one named test or the
  scan when weakened; results are in each control section.
- Artifact scan: `npm run check:dist-secrets` on the built `apps/shell/dist`
  (including the template and code-plugin child paths) reports no credential
  pattern or secret environment value. The CI `shell-dist` artifact downloaded
  for the same run also passes, and an injected `ghp_` fixture exits 1.
- CSP: `check-dist-csp` passes on the downloaded deployed artifact from the
  `90172af` run.
- Dependency audit: `npm audit --omit=dev` reports the Monaco/DOMPurify
  advisories in F4 and no other runtime advisory; the dev-only minimatch
  advisory is F5. Both are accepted with follow-up owners.
- Findings: F1 is resolved in this change; F2-F5 are accepted with rationale and
  owners. No finding is open without a disposition.
