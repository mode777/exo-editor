# Proposal

## Why

Layer 1 deployed an empty shell. It can render chrome and persist layout, but it
cannot open a folder, show a file or save an edit: the explorer is an explicit
empty state, the document area is a placeholder, and the open-workspace command
was deliberately deferred. Layer 2 makes the shell an editor over a folder the
user owns, using the ratified workspace contract, and proves the single mediated
access path before any untrusted plugin is allowed to ask for bytes.

## What Changes

- Add the File System Access folder provider and a deterministic in-memory
  provider, implementing the ratified `WorkspaceProvider` interface and the same
  error, version and abort semantics.
- Add the shell-facing `WorkspaceSession` adapter: path normalization and
  containment, shell-versus-plugin caller identity, the reserved-path guard,
  versioned writes with `conflict`, abort handling and generation-based
  teardown. The session interface is added to the workspace contract and its
  OpenSpec spec, because layer 4 and later consume it.
- Persist the picked directory handle in IndexedDB, restore the workspace after
  reload, query permission, and keep a restored workspace read-only until the
  user grants write access from an explicit action. Handles never enter
  `localStorage`.
- Add the open-folder command and workspace identity: picker cancellation is
  silent, unsupported browsers get an explicit state, and permission or
  filesystem failures are reported against the workspace rather than as global
  toasts.
- Replace the empty explorer with a real workspace tree: lazy listing,
  expand/collapse, create file/folder, rename, delete, keyboard operation,
  refresh on focus and visibility change, and a read-only mode when the provider
  cannot write.
- Replace the placeholder document area with a minimal shell-owned text renderer:
  read, edit, save, dirty dot, save with `ifVersion`, close prompt, external-change
  notice, and an explicit "no editor" state for binary or oversized files.
- Reset tabs, document buffers, caches and in-flight operations on a workspace
  switch, and keep layout and theme. Workspace-scoped tab state is not persisted
  across reloads, so a tab from one folder cannot reappear over another.
- Add a provider conformance suite that runs the same path, version, abort and
  teardown cases against both providers, plus a fake File System Access backend
  for the folder provider and a negative test that stale callbacks cannot mutate
  the next workspace.

Not included: parsing or editing `exo.json` (layer 3), the plugin host and
consent (layer 4), handler sessions (layer 5), plugin events (layer 6), plugin
settings (layer 7), the SDK and template (layer 8) or the Monaco plugin (layer 9).
Firefox and Safari keep an explicit unsupported folder state; no mock files are
shown. The roadmap's "memory provider used by unsupported browsers" clause is
resolved in favour of the ratified unsupported-state requirement: the memory
provider is a test oracle and is not auto-mounted as a fake workspace.

## Capabilities

### New Capabilities

None. Workspace access and the shell surfaces it feeds are already ratified as
`workspace-access` and `editor-shell`; this change implements them and closes the
gaps implementation exposes.

### Modified Capabilities

- `workspace-access`:
  - Added: a defined `WorkspaceSession` interface with shell-originated access,
    caller-scoped plugin access (`forPlugin`) that applies the reserved-path
    guard, `refresh()` for the no-watch polling fallback, an explicit
    permission-escalation operation, and an idempotent `dispose()`.
  - Added: external-change detection on focus/visibility for providers that
    declare `watchable: false`, surfaced through a session callback.
  - Clarified: the session, not the UI, owns normalization, containment,
    reserved-path checks and version comparison.
- `editor-shell`:
  - Added: open-folder and persisted-workspace restore, including the picker
    cancellation, read-only restore and unsupported-browser states.
  - Added: the explorer reflects the live workspace and supports keyboard
    create, rename and delete, with refresh on focus and no fabricated files.
  - Added: a shell-owned text document renderer with read, edit, save, dirty
    state, close prompt, external-change notice and a no-editor state for
    binary or oversized files.
  - Added: workspace failures are reported per workspace and never as a global
    toast that hides which folder failed.

## Impact

- New: `apps/shell/src/workspace/` (provider interface, folder and memory
  providers, session, handle store, controller), explorer and text-document
  components, workspace commands and menus, workspace status bar.
- Changed: `App.tsx` composition root, `views.tsx`, `commands.ts`, `menus.ts`,
  `status-bar.tsx`, `app.css`, and the bundle budget after measurement.
- Contract: `docs/contracts/workspace-api.md` gains the session interface;
  `openspec/specs/workspace-access/spec.md` and `editor-shell/spec.md` receive
  matching deltas. `docs/architecture.md` wording follows the implemented
  session ownership.
- Tests: provider conformance suite, folder-provider tests against a fake
  File System Access backend, IndexedDB restore tests, document and explorer
  tests, reserved-path and stale-callback negative tests.
- Dependency: `fake-indexeddb` as a dev dependency if the test runtime cannot
  provide IndexedDB; no new runtime dependency.
- Compatibility: Chromium only for folder-backed workspaces (D10); layout and
  theme continue to persist through the kit's store; no backend, proxy or
  secret is introduced. `ROADMAP.md` layer 2 status is updated on archive.
