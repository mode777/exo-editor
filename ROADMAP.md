# Exo Editor - Roadmap

Status: layer 0 is complete and its contracts are ratified. Layer 2 is
implemented and awaiting its deployed verification; layer 1 is deployed. Layers
3-10 are sequenced behind it. Each layer is one OpenSpec change. A layer is done
when its change is archived and its exit criteria are demonstrated against the
deployed shell - never from a local dev server or local build.

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

---

## Layer 6 - `plugin-events`

**Goal:** plugins learn about shell state changes without polling or coupling.

**Deliverables**

- Topic bus with subscribe/unsubscribe, per-topic sequence numbers, permission
  checks and the v1 catalog: `theme/changed`, `workspace/file-changed`,
  `workspace/closed`, `config/changed` (catalog entry reserved until layer 7).
- Fan-out to live handler frames only; queue limits and overflow error.
- File change coalescing (50 ms, `deleted` > `created` > `changed`) and ordering
  after save results.
- Initial state in `shell/init` so no replay is needed.

**Exit criteria**

- Toggling the theme reaches a subscribed frame and not an unsubscribed one.
- An external file change reaches the handler for the open file and is coalesced
  under rapid writes.
- A frame that closes does not receive events; a disposed frame's late events are
  dropped.
- Event delivery cannot throw into the shell render path (test with a throwing
  subscriber).

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

Multi-root workspaces, additional providers (OPFS, remote, read-only bundles),
background plugin frames, plugin-to-plugin messaging, marketplace/updates,
signature verification, LSP, terminal, Git, collaboration, Firefox/Safari folder
support.
