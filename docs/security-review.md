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
  actors keep access so the settings surface can read and rewrite `exo.json`.
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

## Findings

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | low | The 16 MiB envelope cap had no direct regression test; payload overflow was only covered indirectly by event and file limits. | Resolved in this change by `protocol.test.ts` and the registration overflow test. |
| F2 | info | jsdom cannot evaluate CSS contrast, so contrast is covered by the token-pair test and the manual deployed check, not axe. | Accepted; documented in `docs/accessibility.md`. |
| F3 | info | The upstream workbench command palette and chrome are not Exo-owned and are excluded from automated axe scans. | Accepted; documented with rationale and owner in `docs/accessibility.md`. |
| F4 | critical (dependency) | `monaco-editor@0.57.0` pins `dompurify@3.4.15` (bundled in `apps/code-plugin`), which is affected by DOMPurify advisories including IN_PLACE node removal and `application/xhtml+xml` parsing. | Accepted with rationale and follow-up owner: Monaco uses the string/`RETURN_TRUSTED_TYPE` path, does not set `IN_PLACE` or `SAFE_FOR_TEMPLATES`, parses as `text/html`, and the editor renders workspace content as text, not as HTML. The code plugin runs in a sandboxed frame with no storage. Upgrade when `monaco-editor` bumps its pinned DOMPurify; re-check this row on every dependency update. |
| F5 | moderate (dev) | `npm audit` reports a `minimatch` ReDoS in the TypeScript ESLint dependency tree. | Accepted: development-only tooling, no runtime or deployed artifact, inputs are repository files rather than untrusted plugin data. Update with the next tooling bump. |

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
