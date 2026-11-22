# Exo Editor - Roadmap

Status: layers 0-10 are complete and archived. Layer 10 (`release-readiness`,
archived as `2026-11-16-release-readiness`) adds the release evidence and author
handoff, verified against the deployed shell and synced into the main specs.
Layer 9 (`monaco-code-plugin`) adds the Monaco reference plugin, its opt-in
visible handler surface and its child-path deployment, verified against the
deployed shell in both same-origin and cross-origin sandboxes. The parallel Stratofold provider track (P1) is
archived as `2026-11-15-add-stratofold-provider` and does not gate the numbered
layers. Its 0.12.0 follow-on, P2 `adopt-stratofold-0-12`, is implemented,
verified against the deployed shell and archived. P3 `add-remote-recents` is
implemented, verified against the deployed shell and archived. Each layer is one
OpenSpec change. A layer is done when its change is archived and its exit
criteria are demonstrated against the deployed shell - never from a local dev
server or local build.

## Sequencing rationale

The shell is reused; the hard parts are the things the workbench kit deliberately
does not do: real workspace access, untrusted plugins, consent, and the protocol
between them. Those have contracts that get more expensive to change once code
depends on them. So the order is:

```text
contracts -> walking skeleton -> real files -> plugin config -> plugin host
          -> file editors -> events -> plugin settings -> SDK/template
          -> reference editor -> hardening
```

Two rules govern the sequence:

1. **No layer starts before its contract is ratified.** Layers 2, 4, 5, 6 and 7
   consume contracts from layer 0. Layer 1 has no contract dependency and may run
   in parallel with layer 0.
2. **No layer adds a second way to do the same thing.** If a layer needs a
   behaviour the contract does not cover, the contract changes first, in that
   layer's change, with the implementation.

The numbered layers are the plugin/core critical path. Provider extensions are
orthogonal: they may start once their dependencies are archived, but they never
gate a numbered layer. The first is the Stratofold provider track (P1), which can
start after layer 3 and should land after layer 4 because both touch the runtime
composition.

| #   | Change                    | Outcome                                                             | Depends on |
| --- | ------------------------- | ------------------------------------------------------------------- | ---------- |
| 0   | `define-core-contracts`   | Contracts ratified as OpenSpec specs                                | -          |
| 1   | `scaffold-shell-app`      | Deployed static shell, CI gates, no plugins                         | -          |
| 2   | `workspace-provider`      | Open a real folder, browse, read, edit, save                        | 0, 1       |
| 3   | `workspace-plugin-config` | `exo.json` parsed, validated, editable; no plugin runtime           | 0, 2       |
| 4   | `plugin-host`             | Consent, manifest load, registration frames, teardown               | 0, 2, 3    |
| 5   | `plugin-file-editors`     | Handler sessions, read/save/dirty, external changes                 | 4          |
| 6   | `plugin-events`           | Topic bus and catalog                                               | 4          |
| 7   | `plugin-settings`         | Plugin-declared settings in the shell's settings UI                 | 3, 4       |
| 8   | `plugin-sdk-template`     | Typed SDK, plugin template, compatibility policy                    | 4, 5, 6    |
| 9   | `monaco-code-plugin`      | Monaco reference plugin, visible handler surface, child-path deploy | 8          |
| 10  | `release-readiness`       | Security review, a11y, browser matrix, author docs                  | 9          |

---

## Provider track (parallel, non-blocking)

| #   | Change                    | Outcome                                                                                           | Depends on | Status                                                                        |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| P1  | `add-stratofold-provider` | Stratofold vdir as a workspace: connect/restore, browse, read/write/save, viewer/public read-only | 0, 2, 3    | archived 2026-11-15; verified on the deployed shell with Chromium and Firefox |
| P2  | `adopt-stratofold-0-12`   | Client 0.12.0: connection-string connect and zero-byte remote files                               | P1         | archived 2026-11-15; verified on the deployed shell                           |
| P3  | `add-remote-recents`      | Automatic connection persistence and a capped recent-workspaces list with reopen/remove           | P1, P2     | archived 2026-11-15; verified on the deployed shell                           |

P1 is not part of the numbered v1 critical path. It started after layer 3 and
lands alongside layers 4-10 without gating one. It integrated through
`WorkspaceRuntime` and the app composition after layer 4, as planned. See
[`docs/providers/stratofold.md`](./docs/providers/stratofold.md) for the contract
mapping, the verified 0.12.0 package surface, residual gaps and upstream asks.

**Goal:** prove the provider abstraction with a real remote store and give the
shell a workspace path that does not depend on the File System Access API.

**Deliverables**

- `StratofoldWorkspaceProvider` implementing the existing
  `WorkspaceProvider`/`WorkspaceHandle`; no contract change.
- Path mapping, capabilities from the token scope/role, version and mtime
  mapping, error mapping, `stat`-based pre-checks for kind/existence/ifVersion,
  and post-write/post-move stat.
- Runtime provider registry plus a connect dialog (server + token, discover the
  vdir and role through `tokenInfo()`), persisted connection config and restore;
  viewer and public workspaces stay read-only.
- Credential storage. P1/P2 used an explicit opt-in; P3 replaced it with
  automatic recent persistence. No token in URLs, bundles, logs or plugin
  messages.
- Conformance and edge tests; verification against the deployed shell.

**Exit criteria**

- Met: `@stratofold/client` 0.11.0 installs from the registry in a clean
  `npm ci`, pinned exactly; no vendoring exception was needed.
- Met: provider conformance plus the documented edge tests pass against a
  deterministic fake server using the published client.
- Met (2026-11-15): against the deployed shell, connect, browse, open a text
  file, edit/save, reload and restore, in Chromium and Firefox; a viewer
  workspace is read-only; a server-side revocation surfaces the explicit
  reconnect state; no token appears in network URLs, the DOM or the bundle.
  Public-vdir mode and Safari remain unverified.
- Met: switching workspaces leaves no session state, and plugin-originated access
  to `/exo.json` and `/.exo/**` is denied.
- Met: the normal `verify` gate, bundle budget and CSP checks pass.

**Not in this track:** multi-root workspaces, sync/offline, file watching,
remote providers beyond Stratofold, OAuth or token brokering.

### P2 - `adopt-stratofold-0-12`

P2 upgrades the same provider to `@stratofold/client` 0.12.0. It adds the
connection-string input and relies on the server-side zero-byte fix without
adding a provider method or changing the session contract. The connect form
parses the string locally, keeps the raw value out of storage and requests, and
leaves the editable server field as the stale-origin override. Empty files use
the normal upload path and need a 0.12.0 server.

**Exit criteria**

- Met: `@stratofold/client` 0.12.0 installs from the registry in a clean
  `npm ci`, pinned exactly.
- Met (2026-11-15): against the deployed shell, a minted connection string
  prefilled the server and token, cleared the raw field and mounted the
  workspace; a malformed value failed locally with zero requests; a stale origin
  mounted after correcting the server field; the raw string appeared in no
  request URL, DOM text, local storage or remembered record.
- Met (2026-11-15): New File created a zero-byte remote file, it opened empty,
  saving text wrote the exact bytes and rotated the version, and saving empty
  content truncated it with another version rotation; 42 remote requests and
  zero page errors.
- Met: the `verify` gate, bundle budget, CSP and custom-element checks pass.

### P3 - `add-remote-recents`

P3 removes the single-connection, opt-in persistence model. Every validated
Stratofold connection is stored automatically in a keyed IndexedDB list, newest
first and capped at ten, and the connect dialog can reopen or remove each entry.
The token stays shell-owned and is never rendered or sent to a plugin;
disconnect keeps an entry, while removal deletes it. A v1 `last` record is
migrated into the list.

**Deliverables**

- Keyed `exo-remote` schema v2 with `list/get/put/remove/clear`, newest-first
  ordering, a ten-entry cap and the v1 migration.
- Automatic persistence on a validated connect, restore by active marker id,
  reconnect that replaces the stored token, and disconnect that retains the
  entry.
- Connect-dialog recent list with Open and Remove, settings removal for the
  active workspace, and no token in the snapshot or rendered UI.
- Store, runtime, App and settings tests; contract, provider and roadmap docs.

**Exit criteria**

- Met: the local `verify` gate passes (lint, format, typecheck, 541 tests,
  build, CSP and custom elements); the measured bundle is 146,708 gzip bytes
  against the 148,000 js limit and 12,946 against the 14,000 css limit.
- Met (2026-11-15): against the deployed shell with a deterministic HTTPS
  Stratofold protocol server, two workspaces appeared newest-first, each
  reopened from the list, removal deleted one token, disconnect kept an entry,
  reload restored the active entry, and a revoked token surfaced the reconnect
  state without mounting or deleting it.
- Met: no token appeared in the DOM, a request URL or `localStorage`; the list
  and snapshot carried metadata only.

---

## Layer 0 - `define-core-contracts`

**Status:** complete - change archived; `openspec validate --all` passes; every
contract document matches its spec; no decision blocks layer 2 or layer 4.

**Goal:** turn the draft contracts in `docs/contracts/` into ratified specs, and
close the decisions that would otherwise be rediscovered mid-implementation.

**Deliverables**

- Ratify `workspace-access`, `plugin-manifest`, `plugin-protocol`,
  `plugin-events` and `editor-shell` as OpenSpec specs.
- Resolve D5 (first-party plugin hosting on the shell origin) and D12 (SDK/repo
  split); confirm D7 (what survives a workspace switch).
- Freeze the v1 numbers: timeouts, payload caps, permissions, glob syntax.
- Add a schema document for `exo.json` and `exo-manifest.json` that the validator
  and the docs both point at.

**Exit criteria (met)**

- `openspec validate --all` passes; every contract doc matches its spec
  requirement text.
- No open decision blocks layer 2 or layer 4.
- Review pass confirms nothing in the protocol requires parsing plugin content
  or handing out a filesystem handle.

**Not in this layer:** any runtime code, the shell, the plugin host.

---

## Layer 1 - `scaffold-shell-app`

**Status:** complete - change archived; deployed at
`https://mode777.github.io/exo-editor/`; the verify and Pages workflows are green
and the exit criteria were demonstrated against the deployed site.

**Goal:** a deployed, empty editor shell with the same verification discipline the
workbench kit already has. This is the walking skeleton.

**Deliverables**

- npm workspace with `apps/shell`, React 19, TypeScript, Vite, `vscode-workbench@0.1.x`
  pinned to a minor.
- Composition root that passes Exo's own empty explorer view, document renderer,
  command registry, menu definitions, quick-open provider and status bar to
  `VSCodeWorkbench`. It must not import the upstream demo layer.
- Token/theme wiring and a persisted layout session. No mocked file tree.
- Commands: open workspace (disabled until layer 2), settings, theme toggle,
  and the palette entries that do not need a workspace.
- CI: install, lint, format check, typecheck, unit test, build; deploy on push to
  `main` to GitHub Pages with the correct `base` path. Pull requests run the same
  gates without deploying.
- `AGENTS.md` commands section updated with the real scripts.

**Exit criteria**

- The deployed URL renders the shell at 1440x900 and a narrow width with no body
  scroll, keyboard navigation works, and a reload restores the layout.
- A PR that breaks lint, typecheck or test is blocked.
- The bundle is measured and a budget file exists; no size regression is silent.
- No plugin code exists in the bundle.

**Risks**

- The preset's contract may not cover a needed hole (for example a custom
  explorer). If so, raise it upstream or compose from `vscode-workbench/react`
  instead of forking. Record the choice.
- GitHub Pages project-site `base` path is a common source of 404s on assets.

---

## Layer 2 - `workspace-provider`

**Status:** complete - change archived on 2026-11-14. Verified against the
deployed shell with Chromium and Firefox. The native directory-picker dialog is
the only browser interaction not drivable by headless automation; the Chromium
workspace was restored from a real File System Access handle instead.

**Goal:** replace the mock file tree with real files the user owns.

**Deliverables**

- Session + provider implementation for the File System Access API, plus an
  in-memory provider used by the conformance tests as the deterministic oracle.
  Unsupported browsers get an explicit unsupported state; the memory provider is
  never mounted as a mock workspace (D10).
- Folder picking, permission restore after reload, workspace identity, canonical
  path handling, reserved-path guard, `conflict` on stale writes.
- Explorer view with expand/collapse, create/rename/delete, keyboard operation,
  and refresh on focus (no watcher exists in the folder provider).
- A minimal shell-owned text document renderer: read, edit, save, dirty dot,
  close prompt, external-change notice. Binary files show a "no editor" state.
- Workspace switch resets tabs, caches and workspace-scoped state.
- Errors surfaced per workspace, not as global toasts that hide which folder
  failed.

**Exit criteria**

- In Chromium: open a folder, open a 1 MiB text file, edit, save, reload the page,
  restore access, and see the saved content.
- Denying permission leaves a read-only workspace with an explicit banner; it
  does not throw.
- Renaming/deleting the open file updates the tab and does not resurrect it on
  save.
- Switching workspaces leaves no tab, cache or watcher behind (verified by a
  test that fails on a stale callback).
- Firefox/Safari show an explicit unsupported state with no broken UI.

---

## Layer 3 - `workspace-plugin-config`

**Status:** complete - change archived on 2026-11-14 after deployed verification
with Chromium. The deployed shell handled missing, valid, invalid, partial,
51-entry and read-only workspaces; add, toggle, remove, raw repair and stale-write
conflict; no manifest request, frame or `exo.json` document tab was observed.

**Goal:** make plugin declaration a first-class, validated workspace artifact
before anything executes.

**Deliverables**

- `exo.json` read on workspace load, validated against the manifest contract's
  rules, with per-entry error reporting.
- Settings surface in the shell: plugin list, enable/disable, remove, add by
  manifest URL (consent comes later; adding validates and stores), open
  `exo.json`, and a canonical rewrite path.
- Reserved-path enforcement in the session, with tests that a plugin-originated
  read/write of `/exo.json` and `/.exo/**` is denied.
- Empty, missing, malformed, partial-failure and over-limit workspace fixtures.

**Exit criteria**

- A malformed `exo.json` disables plugin loading without breaking the workspace.
- Adding and removing entries through the UI produces a diff that is only the
  intended change; comments/formatting loss is documented in the UI.
- `exo.json` cannot be edited through any document tab or plugin path.
- A workspace with 51 entries reports the limit instead of truncating silently.

---

## Layer 4 - `plugin-host`

**Status:** complete - change archived on 2026-11-14 after deployed verification
with Chrome for Testing 131.0.6778.264. Cross-origin registration on
`localhost:5174`, same-origin sandbox and storage, deny, widened re-consent, CORS,
ready timeout, duplicate identity, live add/remove and workspace teardown passed.

**Goal:** load an untrusted plugin's contributions with explicit consent and a
bounded lifecycle. This is the security-critical layer.

**Blockers**

- The consent UI and the manifest validator from layer 0/3 must be final enough to
  fingerprint. No origin decision blocks this layer: first-party plugins may share
  the shell origin (D5), with the stricter sandbox.

**Deliverables**

- Manifest fetch with timeout, size cap, CORS error reporting, redirect handling
  and full validation.
- Consent dialog showing exact origin, publisher, version, controller entry,
  plugin root, declared editor entries, permissions and declared globs, plus a
  same-origin warning when applicable; approve/deny; machine-wide persistence
  keyed by origin, id and capability fingerprint; re-prompt on widening.
- Registration frame: mount the controller entry, handshake, init,
  register/register-complete, ack, unload; timeouts; rollback of partial
  registrations; reject undeclared globs and entries outside the plugin root.
- Plugin registry keyed by plugin id and origin; glob matching with priority;
  "open with" when several plugins match.
- Sandbox selection by origin: `allow-scripts allow-same-origin` cross-origin,
  `allow-scripts` only for a same-origin first-party plugin.
- Late add/remove: a plugin added after load initializes immediately; removal
  tears down frames and registry entries.
- Per-workspace plugin log surface (ids, phases, error codes; no file contents).

**Exit criteria**

- A stub plugin on `localhost:5174` registers a declared glob plus an editor page
  inside its root and appears in the registry; its frame is gone afterwards.
- Denying consent means no frame is ever mounted (verified with a network log).
- Changing a manifest's permissions or globs forces re-consent; adding a sibling
  page inside the root does not.
- A same-origin plugin is mounted without `allow-same-origin` and the consent
  dialog says it has no storage access.
- A manifest without CORS headers produces a clear error naming the origin.
- A plugin that never sends `ready` is removed after the timeout with the phase
  named in the UI.
- Loading a different workspace leaves no registration or consent-derived state
  in the registry (consent itself stays, by design).

**Explicit non-goals:** opening files, sending file content, events, plugin
settings.

---

## Layer 5 - `plugin-file-editors`

**Status:** complete - change archived on 2026-11-15 after deployed verification
with Chrome for Testing 131.0.6778.264; `openspec validate --all` passes.

**Goal:** a third-party editor can open, edit and save a workspace file without
the shell understanding the format.

**Deliverables**

- Handler frame per open document; `shell/init` carries file metadata only.
- `plugin/request-file` with path resolution, containment, reserved-path denial,
  size limits and permission checks.
- Dirty reporting, tab dot, close prompt, save request/response, `ifVersion`
  conflict handling, external-change notification.
- Teardown on tab close, plugin removal, workspace switch; save cancellation.
- A test plugin fixture that exercises read, multiple reads, save, conflict and
  dispose-ack.

**Exit criteria**

- Opening a matching file mounts one handler frame and no content crosses the
  boundary until requested.
- Editing marks the tab dirty; closing prompts; saving writes the exact bytes and
  clears dirty only when appropriate.
- An external write produces `conflict` (or a change event) rather than a silent
  overwrite.
- A handler that stops responding fails the save within 5 s and leaves the tab
  dirty.
- Closing the tab removes the frame; no further messages are accepted.
- Switching workspaces mid-save cancels the write and leaves the old file
  untouched.

**Deployed verification (2026-11-15):** the native directory picker is not
drivable headlessly, so the checks served the folder workspace from the deployed
origin's OPFS handle through a `showDirectoryPicker` stub in Chrome for Testing.
The deployed shell, plugin manifest, registration and handler code were the real
artifacts.

- Opening `second.txt` mounted exactly one hidden `editor.html` frame with
  `sandbox="allow-scripts"`; the document area held no textarea. The handler's
  observation after `shell/init` listed metadata with `reads: []`; after it
  requested the file the observation listed one read with the file version.
- The fixture reported dirty, the tab enabled Save, and Ctrl+S wrote
  `second file\n[fixture save 1]` to the workspace.
- An external write showed the external-change notice; the fixture then reported
  a local edit and a save surfaced the conflict notice while the disk kept
  `second file\n[fixture save 1]\nexternal edit` with no fixture marker added.
- Closing the dirty tab prompted, Discard removed the tab, and no iframe
  remained. Disabling the plugin then opened `third.txt` in the shell text
  surface with no handler frame.
- A `workspace:read`-only manifest opened the editor with no Save action and an
  explicit `Read-only editor` notice. A restored read-only workspace (permission
  query denied read-write) opened the editor with no Save action and an explicit
  `Read-only workspace` notice.

---

## Layer 6 - `plugin-events`

**Status:** complete - change archived on 2026-11-15 after deployed verification;
`openspec validate --all` passes.

**Goal:** plugins learn about shell state changes without polling or coupling.

**Deliverables**

- Topic bus with subscribe/unsubscribe, per-topic sequence numbers, permission
  checks and the v1 catalog: `theme/changed`, `workspace/file-changed`,
  `workspace/closed`, `config/changed` (catalog entry reserved until layer 7).
- Fan-out to live handler frames only; queue limits and overflow error.
- File change coalescing (50 ms, `deleted` > `created` > `changed`) and ordering
  after save results.
- Initial state in `shell/init` so no replay is needed.

**Exit criteria (met)**

- Met: toggling the theme reaches a subscribed frame and not an unsubscribed one.
- Met: an external file change reaches the handler for the open file; three rapid
  external writes reach it as one observed `workspace/file-changed`.
- Met: a frame that closes receives no later event; a disposed frame's late
  events are dropped (`handler.test.ts`, `events.test.ts`).
- Met: a throwing subscriber is contained, removed after three failures and never
  throws into the render path (`events.test.ts`).

**Deployed verification (2026-11-15):** Chrome for Testing 131.0.6778.264 drove
the deployed shell with the folder workspace served from an OPFS handle through a
`showDirectoryPicker` stub, as in layer 5. The deployed shell, plugin manifest,
registration and handler code were the real artifacts.

- The events fixture opened on `/events.events.txt` reported `shell/subscribed`
  with `seq: 0` for `theme/changed`, `workspace/file-changed`,
  `workspace/closed` and `config/changed`; `shell/init` already carried
  `theme: dark` and `workspace.name`.
- Toggling the theme produced one `theme/changed` in the subscribed frame; an
  unsubscribed `.txt` editor produced no event.
- A shell save produced `shell/save-result` before `workspace/file-changed`; an
  external write produced the targeted `shell/file-changed` plus one topic event,
  and three rapid writes were observed as a single event.
- Switching to a workspace whose manifest lacked `events:subscribe` returned
  `permission-denied` for all four subscriptions and delivered no event; the old
  subscribed frame recorded `workspace/closed` with `switch` before disposal and
  received nothing afterwards.
- Not deploy-verified: the `close` reason (folder workspaces have no close action
  in the shell UI; covered by `runtime.test.ts`), the 33rd-topic cap and queue
  overflow (v1 has four topics and no manual path to 1000 queued events; covered
  by `events.test.ts`).
- The local gate passed: 529 tests, bundle budget 145,878/148,000 gzip bytes, and
  the dist CSP and custom-element checks.

---

## Layer 7 - `plugin-settings`

**Status:** complete - change archived as `2026-11-15-plugin-settings` after
deployed verification on 2026-11-15.

**Goal:** a plugin can declare configuration and the shell renders it in the same
settings surface as shell settings.

**Deliverables**

- Manifest `contributes.configuration` (schema: type, default, enum, description,
  scope `workspace` in v1) activated behind the reserved field.
- Settings UI rendering, validation and persistence keyed by workspace + plugin
  id (D11), not written into `exo.json`.
- Delivery through `shell/init` and `config/changed`; reset on workspace switch.
- A plugin cannot read another plugin's settings.

**Exit criteria (met)**

- Met: adding a plugin with a configuration contribution renders string, boolean
  and enum inputs with the declared defaults and descriptions.
- Met: changing a value reaches the plugin's subscribed frame without a reload as
  one targeted `config/changed` with the full value map; a newly opened handler
  receives the new values in `shell/init`.
- Met: values survive reload for the same workspace and vanish for another
  workspace; switching back restores the first workspace's values.
- Met: an invalid stored value falls back to the default with a visible warning
  for that setting while the plugin receives the default.

**Deployed verification (2026-11-15):** Chrome for Testing 131.0.6778.264 drove
`https://mode777.github.io/exo-editor/` with folder workspaces served from OPFS
handles through a `showDirectoryPicker` stub, as in layers 5 and 6. The deployed
shell, fixture manifest, registration and handler code were the real artifacts.
No local build or dev server was used.

- The fixture's settings block rendered `fixture.greeting` (string),
  `fixture.repeat` (boolean) and `fixture.size` (number enum) with the manifest
  defaults and descriptions.
- Changing the string, boolean and enum produced `config/changed` events with
  sequence numbers 1, 2 and 3, each carrying the full map; a handler opened
  afterwards received `{ greeting: 'deployed hello', repeat: true, size: 3 }` in
  `shell/init`.
- A reload restored the same values in the settings surface and `shell/init`. A
  second workspace showed the defaults, and switching back restored the first
  workspace's values.
- Seeding `fixture.size = 9` in the `exo-plugin-settings` IndexedDB record and
  reloading showed the invalid-stored warning, the settings select showed `1`,
  and the plugin's `shell/init` carried `size: 1` with the other values intact.
- No setting change rewrote `exo.json`, added a workspace file or opened an
  `exo.json` document tab. A manifest without `events:subscribe` showed the
  no-live-update hint and received no `config/changed` event.
- The local gate passed: 579 tests, bundle budget 149,603/152,000 gzip bytes
  (CSS 12,991/14,000), and the dist CSP and custom-element checks.

---

## Layer 8 - `plugin-sdk-template`

**Status:** complete - change archived as
`2026-11-16-plugin-sdk-template` after deployed verification.

**Goal:** remove the protocol hand-rolling cost and freeze a compatibility story.

**Deliverables**

- `packages/plugin-sdk`: typed envelope helpers, handshake client, registration
  helper, file handler client, event subscription, strict origin checking, no DOM
  assumptions.
- `packages/plugin-template`: minimal plugin using the SDK, with dev server on a
  second origin, build, typecheck and a protocol conformance test.
- Compatibility policy: SDK version vs protocol major vs manifest schema;
  deprecation rules.
- D12 is settled for v1: the SDK/template stays a workspace package. Revisit
  publishing or splitting only after layer 9, not in this layer.
- Optional: shared component reuse for plugin UI. Only if it does not weaken the
  origin or CSP model, and never by loading shell code into the plugin frame
  without a versioned contract.

**Exit criteria (met)**

- Met: the template registers, edits and saves with no hand-written envelope,
  handshake, registration or handler code; its source scan rejects those markers.
- Met: the SDK conformance suite drives the real `RegistrationSession` and
  `HandlerSession`, including wrong origin, source, mode and session cases.
- Met (2026-11-16): against the deployed shell, the template manifest shows the
  same-origin warning, the controller registers one editor, and the editor
  handler reads, reports dirty, saves `[template save 1]`, reopens with the saved
  content and disposes without a protocol violation.
- Met (2026-11-16): the protocol-mismatch diagnostic produces
  `{ code: 'unsupported-version', expected: '1', received: '2' }` in its console,
  the shell plugin log records `register unsupported-version`, and no editor or
  frame remains.
- Met: the deployed shell asset contains no `ExoProtocolError`,
  `@exo/plugin-sdk` or `EXO_TEMPLATE_` marker; the template is served only from
  its child path.
- Met: the local gate passes (lint, format, typecheck, 637 tests, shell build,
  bundle budget 149,603/152,000 js and 12,991/14,000 css, CSP, custom elements,
  no-SDK check, template build and deploy copy).

**Commands:** `npm run dev:template`, `npm run build:template`,
`npm run deploy:copy-template`, `npm run check:dist-no-sdk`.

**Deployed verification (2026-11-16):** Chrome for Testing 131.0.6778.264 drove
`https://mode777.github.io/exo-editor/` with a folder workspace served from an
OPFS handle through a `showDirectoryPicker` stub, as in layers 5-7. The deployed
shell, template manifest, controller and editor code were the real artifacts; no
local build or dev server was used.

- The consent dialog showed the exact same-origin warning, the controller logged
  `EXO_TEMPLATE_REGISTER`, and the hidden editor frame used
  `sandbox="allow-scripts"`.
- The editor's `#observation` showed metadata with one read, `dirty: true` and no
  storage; saving wrote `hello from the deployed template\n\n[template save 1]`
  and rotated the version.
- A page reload/reopen read the saved 36-byte content; an external write produced
  the targeted change, a re-read and the external-change banner; discarding the
  dirty tab removed the frame.
- The protocol-mismatch manifest surfaced
  `{ code: 'unsupported-version', expected: '1', received: '2' }` before the
  shell unmounted the frame and the plugin log recorded
  `com.example.exo.template-mismatch register unsupported-version`.

---

## Layer 9 - `monaco-code-plugin`

**Status:** complete - change archived as `2026-11-16-monaco-code-plugin` after
deployed verification on 2026-11-16.

**Goal:** prove the architecture with the real editor users expect, deployed like
any third-party plugin.

**Deliverables**

- Monaco-based plugin built with the SDK; languages registered by the plugin, no
  LSP. The plugin adds no protocol message, envelope field or shell dependency.
- Opt-in `rendering: "frame"` on `contributes.fileEditors` (default `"hidden"`)
  and a generic shell surface that displays the active document's handler iframe
  in the document area. Registration frames stay hidden; tab, header, Save action
  and notices stay outside the frame; a tab switch hides without disposing.
- Dirty/save/external-change handling; a 5 MiB Monaco guard; theme sync via
  `theme/changed`.
- Child path of the shell's GitHub Pages site by default (same origin, stricter
  sandbox), copied after the shell budget checks; the same build runs cross-origin
  from the dev server for the looser sandbox check.
- An example workspace whose `exo.json` points at the deployed manifest, plus
  documented manual test steps.
- Explicit statement that the shell has no Monaco dependency and no privileged
  code path: source and dist guards fail CI if Monaco or the reference plugin
  enters the shell bundle.

**Exit criteria (met)**

- Met (2026-11-16): against the deployed shell, opening `.ts`, `.json` and `.md`
  files uses the Monaco plugin, and keyboard input, dirty reporting, Save and
  exact-text persistence round-trip.
- Met (2026-11-16): disabling the plugin in settings falls back to the shell's
  text renderer with no visible plugin frame.
- Met: the shell bundle contains no Monaco code and the CI `Monaco absent from
shell bundle` step passes, as does the source composition guard.
- Met (2026-11-16): the same-origin deploy uses `sandbox="allow-scripts"`,
  `localStorage` throws `SecurityError` in the frame, and editing still works;
  the cross-origin `localhost:5176` deploy uses
  `sandbox="allow-scripts allow-same-origin"` and its storage check succeeds.

**Commands:** `npm run dev:code`, `npm run build:code`,
`npm run deploy:copy-code`, `npm run check:dist-no-monaco`.

**Deployed verification (2026-11-16):** Chrome for Testing 131.0.6778.264 drove
`https://mode777.github.io/exo-editor/` with folder workspaces served from OPFS
handles through a `showDirectoryPicker` stub, as in layers 5-8. The deployed
shell, code-plugin manifest, controller and editor code were the real artifacts;
no local build or dev server was used.

- Same-origin: the consent dialog showed the same-origin warning and the
  frame-rendering disclosure. `hello.ts` mounted a visible `TypeScript editor`
  surface at 1052x746 with `sandbox="allow-scripts"`; keyboard input reached
  Monaco, dirty state reached the shell, Save wrote the exact text, and
  `localStorage` access threw `SecurityError`.
- Same-origin: `.json` and `.md` files selected the JSON and Markdown languages
  and saved exact text. Toggling the shell theme changed Monaco from `vs-dark` to
  `vs`; an external clean write reloaded the model; a 6.0 MiB `.ts` file showed
  the 5 MiB refusal without creating a Monaco model. Disabling the plugin wrote
  `"enabled": false`, closed the frames and opened `hello.ts` in the text area.
- Cross-origin: the same build served on `http://localhost:5176/` showed its exact
  origin, no same-origin warning, the frame-rendering disclosure,
  `sandbox="allow-scripts allow-same-origin"`, working storage, and an exact-text
  edit/save round-trip.
- The local gate passed: 666 tests, bundle budget 150,494/152,000 js and
  13,006/14,000 css gzip bytes, CSP, custom elements, no-SDK and no-Monaco
  checks, template and code-plugin builds, and `openspec validate --all`.

**Follow-up (2026-11-16):** the post-layer-9 change `plugin-initiated-save` adds
the id-less `plugin/request-save` intent and wires Ctrl/Cmd+S in the reference
editor. It is additive within protocol major `1`; content and `ifVersion` still
come only through the shell-initiated save round trip. Verified against the
deployed shell: Ctrl+S wrote once and cleared dirty, was a no-op when clean or
read-only, surfaced a conflict without writing or losing the buffer, the shell
Save button still worked, and the cross-origin sandbox round-tripped. The local
gate passed with 675 tests and a 150,607/152,000 js gzip budget.

---

## Layer 10 - `release-readiness`

**Status:** complete and archived as `2026-11-16-release-readiness` after the
deployed verification on 2026-11-16 against commit `90172af`. The
`plugin-authoring`, `editor-shell` and `workspace-access` deltas are synced into
`openspec/specs/`.

**Goal:** a v1 that can be handed to someone who did not build it.

**Deliverables**

- Security review: origin/source validation, path containment, reserved paths,
  CSP, sandbox attributes, payload limits, consent fingerprint, no secrets. See
  [`docs/security-review.md`](./docs/security-review.md).
- Accessibility pass on explorer, tabs, dialogs, settings and palette. See
  [`docs/accessibility.md`](./docs/accessibility.md).
- Browser matrix documented; Chromium supported for folder workspaces, others
  explicit. See [`docs/browser-support.md`](./docs/browser-support.md).
- Performance budgets: shell bundle, plugin frame startup, 10k-entry folder
  listing, 1 MiB file open/save. See [`docs/performance.md`](./docs/performance.md).
- Plugin author guide: manifest reference, protocol reference, SDK usage,
  hosting/CORS checklist, consent expectations, examples. See
  [`docs/guide/`](./docs/guide/README.md).
- Demo workspace and a recorded walkthrough:
  [`examples/demo-workspace/`](./examples/demo-workspace/README.md) and
  [`docs/walkthrough.md`](./docs/walkthrough.md).
- Versioning/communication plan for breaking protocol changes. See
  [`docs/releases.md`](./docs/releases.md) and [`CHANGELOG.md`](./CHANGELOG.md).

**Exit criteria (met)**

- Met: the guide-only dry run fixed the two SDK sample gaps and the deployed
  template registered, read, saved and disposed using only documented steps.
- Met: the bundle budget is CI-enforced and the runtime budgets are recorded in
  [`docs/performance.md`](./docs/performance.md) with the procedure and results.
- Met: no open security finding; every control is mutation-checked, the deployed
  artifact scan and CSP pass, and the two dependency advisories are accepted with
  rationale and owners in [`docs/security-review.md`](./docs/security-review.md).
- Met: layers 0-9 are archived and the layer-10 deltas are synced into the main
  specs.

**Deployed verification (2026-11-16):** Chrome for Testing 131.0.6778.264 drove
`https://mode777.github.io/exo-editor/` at commit `90172af` with the demo
workspace on an OPFS handle through a `showDirectoryPicker` stub.

- Security: all ten controls failed a named test when mutated; the downloaded
  `shell-dist` artifact has no credential pattern and its CSP check passes. No
  finding is open without a disposition; F4 (Monaco's pinned DOMPurify) and F5
  (dev minimatch) are accepted with rationale and owners.
- Accessibility: axe reports no Exo-owned violation; both theme palettes pass
  the text 4.5:1 and focus 3:1 pairs; the deployed consent and settings dialogs
  trap Tab, close on Escape and the consent focus order cycles
  Deny -> Allow -> homepage -> Deny. No screen-reader host was available, so
  that human step is recorded as not run, not as passed.
- Browser matrix: Chromium folder and remote workspaces pass; a page without a
  directory picker shows the explicit unsupported state and still offers Connect
  Remote; Firefox and Safari remain as classified in
  [`docs/browser-support.md`](./docs/browser-support.md), with plugin hosting on
  Firefox unverified.
- Performance (median / max, five runs after warm-up): plugin startup 706 / 815
  ms; 10k listing 1,094 / 1,176 ms with a 442 / 551 ms longest task; 1 MiB shell
  open 207 / 275 ms and save 33 / 35 ms; 1 MiB code-plugin open 798 / 942 ms and
  save 49 / 90 ms. Every ceiling is met and no miss is accepted.
- Guide and demo: the guide suggested `npm run dev:template` and the deployed
  demo manifests; the template's observation recorded one read, `saves: [1]`,
  `lastSave.ok` and a rotated version, and its frame was removed on close. The
  code plugin round-tripped `export const walkthrough = true` and the shell text
  surface saved its edit. Nine screenshots are committed under
  [`docs/media/walkthrough/`](./docs/media/walkthrough/).
- Release docs: the changelog matches shell `0.1.0`, protocol `1`, schema `1`
  and SDK `1.1.0`; the release checklist and upgrade-note rule are in
  [`docs/releases.md`](./docs/releases.md).

**Follow-up (2026-11-16):** the post-layer change `file-menu-connect-remote`
adds `Connect Remote Workspace…` to the File menu, directly after
`Open Folder…`. The entry runs the existing `exo.workspace.connectRemote`
command, so the menu, palette, settings and empty-explorer paths share one
dialog and one dirty-document guard. Verified against the deployed shell at
commit `90172af`: the File menu listed the entry with and without a workspace,
both states opened the same connect dialog, and Cancel on the unsaved-changes
prompt left the document dirty and unchanged with the dialog closed. The local
gate passed with 666 shell tests and a 151,022/152,000 js gzip budget.

**Follow-up (2026-11-18):** the post-layer-10 change `plugin-file-picker` adds
`plugin/request-files` / `shell/files-selected`, the shell-owned workspace
picker for active visible handlers, the `capabilities.filePicker` support bit
and SDK `1.2.0`. Verified against deployed commit `a868f08`: the picker opened
only from a focused visible fixture frame, listed no reserved paths, returned
paths only, read the selected file through `plugin/request-file`, saved the
fixture edit, handled keyboard navigation and Escape, rate-limited a second
request, closed on tab switch, tab close, plugin disable and workspace switch,
and denied a hidden handler. The local gate passed with 691 shell tests and a
153,541/154,000 js gzip budget; the 2,000-byte increase is recorded in
[`docs/performance.md`](./docs/performance.md).

**Follow-up (2026-11-18):** the post-layer-10 change `plugin-workspace-listing`
adds `plugin/request-list` / `shell/list-result`, the `workspace:list`
permission, the `capabilities.directoryListing` support bit and SDK `1.3.0`.
Verified against deployed commit `5aa1382`: the fixture listed the workspace
root, its own directory and a 1,001-entry directory (1,000 entries plus a
cursor, then the remaining entry), returned only path/kind/size entries, read
`/notes.txt` through `plugin/request-file`, hid `exo.json` and `.exo`, mapped a
file path to `not-a-directory`, a missing directory to `not-found` and
`/exo.json` to `permission-denied`. A workspace switch disposed the old frame
and the new workspace listed only `/switch-only.txt`; a read-only manifest got
six `permission-denied` replies and no page, and disabling the plugin removed
the handler. The local gate passed with 715 shell tests and a 155,716/157,000 js
gzip budget; the 3,000-byte increase is recorded in
[`docs/performance.md`](./docs/performance.md).

**Follow-up (2026-11-20):** the post-layer-10 change `plugin-local-events`
(archived as `2026-11-20-plugin-local-events`) adds
`plugin/publish` / `shell/published`, the identity-scoped `local/<name>` topic
namespace, `capabilities.localEvents` and SDK `1.4.0`. It also moves the single
`EventBus` to the workspace runtime so handler pools share it without resetting
each other. Verified against deployed commit `877cfdf` (asset
`index-W51L97VC.js`): a first frame published `local/fixture` at sequence 1 and
received its own event with its own `from`; a late second frame got the current
sequence, then received a later first-frame event and its own, with the first
frame receiving the second frame's event. A second plugin identity on the same
topic neither received nor leaked events. Oversized payloads returned
`too-large`, `theme/changed` returned `permission-denied` and `local/State`
returned `unsupported-topic`. The local gate passed with 742 shell tests and a
157,056/159,000 js gzip budget; the 1,340-byte increase is recorded in
[`docs/performance.md`](./docs/performance.md).

**Follow-up (2026-11-20):** the post-layer-10 change `plugin-view-surfaces`
(archived as `2026-11-20-plugin-view-surfaces`) adds `contributes.panels` and
`contributes.contentViews`, the `view` frame mode,
lazy panel mounting with retained frames, read-only content-view tabs, the
`plugin/open-file`, `plugin/open-view` and `plugin/request-panel` intents, and
SDK `1.5.0`; shell `0.3.0`. Panels and content views are listed in the first-grant
consent prompt and deliberately excluded from the fingerprint. Verified against
deployed commit `3f69504` (asset `index-BotyjZ52.js`): consent listed the panels
and content view; a panel created no frame until first reveal, used
`sandbox="allow-scripts"`, matched its placeholder bounds and reused its session
when re-shown; a secondary panel appeared through `request-panel`, the picker
listed both panels with plugin names and supported arrow keys and Escape; a
same-plugin content view carried its payload and `openedBy`, opened a file and
reused its frame across tab switches; a hidden content frame was denied an
intent and opened no tab; a cross-plugin content view received `openedBy` but no
local event from the opener; a 64 KiB payload returned `too-large` with the limit
and opened no tab; the palette opened a content view with no payload. Closing a
content tab disposed its frame; disabling the plugin removed its activity item,
frames and content tabs; switching workspaces cleared the tabs. The local gate
passed with 801 shell tests and a 165,357/167,000 js gzip budget; the 6,357-byte
increase is recorded in [`docs/performance.md`](./docs/performance.md). View
startup measured on the deployed shell: panel reveal median 28 / max 140 ms and
content-view open median 471 / max 494 ms against the 2,000 ms ceiling.

**Follow-up (2026-11-20):** the post-layer-10 change `plugin-commands`
(archived as `2026-11-20-plugin-commands`) adds
`contributes.commands`, `plugin/register.commands`, the additive
`acceptedCommands` acknowledgement, `target-not-registered`, the `shell/command`
and `plugin/command-result` messages with their limits, shell-owned palette,
explorer and editor-action surfaces, and SDK `1.6.0`; shell `0.4.0`. Commands are
user-invoked, run only in live frames of the same plugin, are listed in the
first-grant consent prompt and are deliberately excluded from the fingerprint.
Verified against deployed commit `6fa641e` (asset `index-BowKZcSd.js`): the
consent prompt listed all five fixture commands with targets and placements; the
matching `*.txt` editor showed a shell-owned action row labelled with the plugin
and a shell text document showed none; the palette and explorer menu attributed
every entry to the plugin; Format reached the active editor with no arguments;
Generate reached a lazily mounted primary panel with `{ path: "/notes.txt", kind:
"file" }` and then `{ path: "/reports", kind: "directory" }`; Inspect opened one
content-view tab and a second invocation reused its frame; Fail produced a
dismissible plain-text notice and Timeout produced a notice after ten seconds
while the editor frame stayed mounted; a captured menu entry invoked after the
plugin was disabled recorded a `stale` log entry and delivered nothing; the
palette dropped the disabled commands. The full local gate passed with 845 shell
tests, 86 SDK tests and a 169,686/171,000 js gzip budget; the 4,329-byte increase
is recorded in [`docs/performance.md`](./docs/performance.md). First-command
panel mount measured median 33 / max 37 ms against the 2,000 ms ceiling. The
command surfaces also passed the 200% zoom equivalent (640x400) with no clipping
or horizontal overflow.

**Follow-up (2026-11-20):** the post-layer-10 change `plugin-file-creation` adds
`contributes.newFiles`, the shell-owned Save As dialog, the correlated
`plugin/request-new-file` / `shell/new-file-result` messages, the create-only
`WriteOptions.createOnly` path, `capabilities.createFile`/`capabilities.newFiles`
and SDK `1.7.0`; shell `0.5.0`. Templates and runtime requests share one
controller and one create-only write. The memory provider is atomic; the folder
and Stratofold providers pre-check and document the residual check-to-write race
because neither exposes a target-absent conditional create. Verified against deployed commit `bc8270a` on 2026-11-20 with
`chrome-headless-shell` 131: the explorer menu and consent named the plugin,
the text template wrote exact bytes and refreshed the explorer, a collision kept
the dialog open and preserved content, the binary template wrote `00 01 02 ff`,
Escape wrote nothing, the generator view created text and bytes with no automatic
tab, and an 8 MiB probe returned `too-large` with the actual size and limit and
opened no dialog. The local gate passed with 894 shell tests, 95 SDK tests and
4 template tests; the measured bundle was 173,554/176,000 js and
13,794/14,000 css gzip bytes.

**Follow-up (2026-11-22):** the post-layer-10 change
`content-view-companion-panel` adds optional
`contributes.contentViews[].companionPanel`, validated against a secondary panel
in the same manifest and preserved on the registered view. The shell reveals the
companion when a content view opens or is focused, keeps it while any open
instance shares it, and hides it after the last instance closes; visibility is
derived from open view records across tab close, plugin removal and workspace
switch. The field adds no permission, consent fingerprint input, protocol
message or SDK API; shell `0.6.0`, manifest schema `1`, protocol `1` and SDK
`1.7.0`. Verified against deployed commit `fbbce58` on 2026-11-22 with
`chrome-headless-shell` 131: the fixture content view revealed
**Fixture Inspector** on open; a manual close stayed hidden until the tab was
refocused; a second instance kept the companion open after the first close and
the last close hid it; selecting **Fixture Inspector 2** left that panel visible
when the content view closed; and a localhost plugin with an unregistered
companion opened its content view with no side bar or error. The CI `verify` job
and Pages deploy passed; the bundle measured 174,159/176,000 js and
13,785/14,000 css gzip bytes.

**Follow-up (2026-11-22):** the post-layer-10 change `plugin-theming` adds the
optional `@exo/plugin-sdk/theme` entry with `applyTheme()` and `followTheme()`,
the `@exo/plugin-sdk/theme.css` semantic token sheet for dark, light and
high-contrast, SDK `1.8.0` and shell `0.7.0`. It also adds the styling contract,
the author-guide styling page and a styling step in the `create-exo-plugin`
skill, and moves the reference code plugin to the SDK tokens and helper. No
protocol message, manifest field, permission or consent fingerprint input
changes. Verified against deployed commit `056e946` on 2026-11-22 with
`chrome-headless-shell` 131: the code-plugin frame started at `data-theme=dark`
with `--exo-bg: #1f1f1f` and Monaco `vs-dark`, and toggling the theme changed it
to `data-theme=light`, `--exo-bg: #fff`, a white body background and Monaco `vs`
without reopening the file; the page recorded zero errors and the guide,
contract and raw skill URLs returned 200. The CI `verify` job and Pages deploy
passed; the bundle measured 174,159/176,000 js and 13,785/14,000 css gzip bytes.
The change is archived as `2026-11-22-plugin-theming`.

---

## Deferred beyond v1

Multi-root workspaces, additional providers beyond the P1 Stratofold track
(OPFS, other remote stores, read-only bundles), background plugin frames,
plugin-to-plugin messaging, marketplace/updates, signature verification, LSP,
terminal, Git, collaboration, Firefox/Safari folder support.

The P1 Stratofold provider is a parallel track that can start after layer 3 and
land independently of the numbered layers. It is not part of the v1 release gate
unless the roadmap and `docs/vision.md` are explicitly re-scoped.
