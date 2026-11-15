# Exo Editor - Roadmap

Status: layers 0-6 are complete and archived. Layer 7 (`plugin-settings`) is
next. The parallel Stratofold provider track (P1) is archived as
`2026-11-15-add-stratofold-provider` and does not gate the numbered layers. Its
0.12.0 follow-on, P2 `adopt-stratofold-0-12`, is implemented and verified against
the deployed shell; archive pending. Each layer is one OpenSpec change. A layer
is done when its change is archived and its exit criteria are demonstrated
against the deployed shell - never from a local dev server or local build.

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

| # | Change | Outcome | Depends on |
| --- | --- | --- | --- |
| 0 | `define-core-contracts` | Contracts ratified as OpenSpec specs | - |
| 1 | `scaffold-shell-app` | Deployed static shell, CI gates, no plugins | - |
| 2 | `workspace-provider` | Open a real folder, browse, read, edit, save | 0, 1 |
| 3 | `workspace-plugin-config` | `exo.json` parsed, validated, editable; no plugin runtime | 0, 2 |
| 4 | `plugin-host` | Consent, manifest load, registration frames, teardown | 0, 2, 3 |
| 5 | `plugin-file-editors` | Handler sessions, read/save/dirty, external changes | 4 |
| 6 | `plugin-events` | Topic bus and catalog | 4 |
| 7 | `plugin-settings` | Plugin-declared settings in the shell's settings UI | 3, 4 |
| 8 | `plugin-sdk-template` | Typed SDK, plugin template, compatibility policy | 4, 5, 6 |
| 9 | `monaco-code-plugin` | Reference plugin, separate deploy, no shell changes | 8 |
| 10 | `release-readiness` | Security review, a11y, browser matrix, author docs | 9 |

---

## Provider track (parallel, non-blocking)

| # | Change | Outcome | Depends on | Status |
| --- | --- | --- | --- | --- |
| P1 | `add-stratofold-provider` | Stratofold vdir as a workspace: connect/restore, browse, read/write/save, viewer/public read-only | 0, 2, 3 | archived 2026-11-15; verified on the deployed shell with Chromium and Firefox |
| P2 | `adopt-stratofold-0-12` | Client 0.12.0: connection-string connect and zero-byte remote files | P1 | implemented; verified 2026-11-15 on the deployed shell; archive pending |

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
- Credential storage with explicit opt-in. No token in URLs, bundles, logs or
  plugin messages.
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

**Goal:** a plugin can declare configuration and the shell renders it in the same
settings surface as shell settings.

**Deliverables**

- Manifest `contributes.configuration` (schema: type, default, enum, description,
  scope `workspace` in v1) activated behind the reserved field.
- Settings UI rendering, validation and persistence keyed by workspace + plugin
  id (D11), not written into `exo.json`.
- Delivery through `shell/init` and `config/changed`; reset on workspace switch.
- A plugin cannot read another plugin's settings.

**Exit criteria**

- Adding a plugin with a configuration contribution renders inputs in settings.
- Changing a value reaches the plugin's frame without a reload.
- Values survive reload for the same workspace and vanish for another workspace.
- Invalid stored values fall back to defaults with a visible warning.

---

## Layer 8 - `plugin-sdk-template`

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

**Exit criteria**

- A plugin built from the template registers, edits and saves with no protocol
  code in its own repository.
- The SDK's conformance test runs against the shell's protocol fixtures.
- Version mismatch produces an actionable error, not a blank frame.

---

## Layer 9 - `monaco-code-plugin`

**Goal:** prove the architecture with the real editor users expect, deployed like
any third-party plugin.

**Deliverables**

- Monaco-based plugin built with the template and SDK; languages registered by
  the plugin, no LSP.
- Dirty/save/external-change handling; large-file guard; theme sync via
  `theme/changed`.
- Sibling or child path of the shell's GitHub Pages site by default (same origin,
  stricter sandbox); a separate origin if the plugin needs storage or stricter
  separation, with its own base path and CI.
- An example workspace whose `exo.json` points at the deployed manifest, plus
  documented manual test steps.
- Explicit statement that the shell has no Monaco dependency and no privileged
  code path.

**Exit criteria**

- Against the deployed shell, opening `.ts`, `.json` and `.md` files uses the
  plugin; editing and saving round-trips.
- Disabling the plugin in settings falls back to the shell's text renderer.
- The shell bundle contains no Monaco code.
- The plugin is sandboxed according to its origin relationship: a same-origin
  first-party deploy gets `allow-scripts` only and has no storage, verified in the
  browser; a cross-origin deploy keeps `allow-same-origin` and is verified too.

---

## Layer 10 - `release-readiness`

**Goal:** a v1 that can be handed to someone who did not build it.

**Deliverables**

- Security review: origin/source validation, path containment, reserved paths,
  CSP, sandbox attributes, payload limits, consent fingerprint, no secrets.
- Accessibility pass on explorer, tabs, dialogs, settings and palette.
- Browser matrix documented; Chromium supported for folder workspaces, others
  explicit.
- Performance budgets: shell bundle, plugin frame startup, 10k-entry folder
  listing, 1 MiB file open/save.
- Plugin author guide: manifest reference, protocol reference, SDK usage,
  hosting/CORS checklist, consent expectations, examples.
- Demo workspace and a recorded walkthrough.
- Versioning/communication plan for breaking protocol changes.

**Exit criteria**

- A new developer can build a plugin from the guide without reading shell source.
- All budgets are enforced by CI or a documented manual check.
- No open security finding above "accepted with rationale".
- Roadmap layers 0-9 are archived or explicitly deferred, and `openspec/specs/`
  reflects the shipped system.

---

## Deferred beyond v1

Multi-root workspaces, additional providers beyond the P1 Stratofold track
(OPFS, other remote stores, read-only bundles), background plugin frames,
plugin-to-plugin messaging, marketplace/updates, signature verification, LSP,
terminal, Git, collaboration, Firefox/Safari folder support.

The P1 Stratofold provider is a parallel track that can start after layer 3 and
land independently of the numbered layers. It is not part of the v1 release gate
unless the roadmap and `docs/vision.md` are explicitly re-scoped.
