# Design

## Context

See [`proposal.md`](./proposal.md) for motivation and the two spec deltas for
required behavior. The starting point is the layer 1 composition: `apps/shell`
renders `VSCodeWorkbench` with an empty explorer, a placeholder document
renderer, two commands and the preset's persisted layout store. There is no
workspace code, no document state and no dependency injection.

Three constraints shape the implementation:

- The preset owns tabs. In `vscode-workbench@0.1.3` it persists
  `tabs`, `activeTabId` and `closedTabs` in `desktop-ui-template:v1`, closes a
  tab unconditionally from its own strip, and has no dirty-close hook and no
  `markTabDirty` action.
- The workspace contract already defines providers, paths, reserved names,
  versions, errors and teardown, but it does not define the `WorkspaceSession`
  interface the shell will consume or the permission-request operation a
  read-only restore needs. Both are added by this change.
- TypeScript 5.9's `lib.dom` omits parts of the File System Access API used here
  (`showDirectoryPicker`, `queryPermission`, `requestPermission`, directory
  iteration and `move`). The implementation needs a local ambient declaration,
  not a new dependency.

## Goals / Non-Goals

**Goals:**

- One provider interface, two implementations, one session, and a conformance
  suite that proves parity before any plugin consumes the session.
- A workspace UI that is real, keyboard-operable and honest about permission,
  unsupported-browser and error states.
- A preset integration that keeps layout and theme working, makes tabs
  workspace-scoped, and does not fork or patch the kit.
- Testable seams for the picker, the filesystem, IndexedDB and the clock, so the
  security and lifecycle rules have negative tests.

**Non-Goals:**

- Tab restoration across reloads, multi-root workspaces, file watching through a
  browser API, or cross-browser folder support.
- Populating quick open with a recursive file index; the explorer and commands
  are the layer 2 entry points.
- Parsing `exo.json`, plugin loading, consent, events or plugin settings.
- Virtualizing a 10k-entry directory; lazy listing limits the cost until the
  hardening layer measures it.

## Decisions

### D1. Runtime composition and module boundaries

The shell owns a `WorkspaceRuntime` created once per app instance and provided
through React context. `main.tsx` prepares the preset store, `App` accepts an
optional runtime for tests, and the runtime exposes a `useSyncExternalStore`
snapshot rather than adding a second state library.

```text
src/workspace/
  contract.ts          mirrored contract types, WorkspaceError, error mapping
  paths.ts             normalization, containment, reserved-path helpers
  session.ts           shell access, forPlugin facade, refresh, dispose
  controller.ts        open/restore/switch lifecycle and snapshot store
  providers/
    memory.ts          deterministic test oracle
    conformance.ts     shared provider suite (test support)
    folder/
      provider.ts      File System Access provider
      handle-store.ts  IndexedDB persistence
      fsa.ts           ambient FSA declarations and DOMException mapping
src/explorer/          tree, inline edit, dialogs
src/document/          document store and text surface
src/workbench/tabs.ts  the only adapter that writes preset tab state
```

The runtime owns the current provider, session and generation. Each open or
restore creates a fresh provider because the contract makes `dispose()` terminal.
The old session is disposed before the new session is created, but the picker
runs first: a cancelled or rejected picker returns before any teardown, so the
active workspace is untouched.

Alternative rejected: a global singleton runtime. It makes tests share state and
turns a StrictMode remount into a real workspace reload.

### D2. The session contract is implemented, not approximated

`WorkspaceSession` is the shell-facing interface added to
`docs/contracts/workspace-api.md`:

```ts
interface WorkspaceAccess {
  list(path, options?): Promise<FileStat[]>
  stat(path, options?): Promise<FileStat>
  read(path, options?): Promise<Uint8Array>
  write(path, data, options?): Promise<FileStat>
  mkdir(path, options?): Promise<void>
  remove(path, options?): Promise<void>
  move(from, to, options?): Promise<FileStat>
}

interface WorkspaceSession extends WorkspaceAccess {
  readonly descriptor: WorkspaceDescriptor
  capabilities(): WorkspaceCapabilities
  forPlugin(pluginId: string): WorkspaceAccess
  requestPermission(options?): Promise<WorkspaceCapabilities>
  setOpenDocuments(
    documents: Array<{ path: WorkspacePath; version: string }>,
  ): void
  refreshOpenDocuments(): Promise<WorkspaceChange[]>
  onExternalChange(listener: (change: WorkspaceChange) => void): Disposable
  dispose(): Promise<void>
}
```

Shell methods are unrestricted except for normalization. `forPlugin` is a thin
object whose methods call the same internals with `{ kind: 'plugin', pluginId }`;
the internals apply reserved-path filtering and write the plugin id into the
operation log. `WorkspaceHandle` gains an optional
`requestPermission(): Promise<WorkspaceCapabilities>` because the provider
contract had no way to perform the gesture-bound escalation its restore scenario
already required.

The shell does not import a contract package. `contract.ts` mirrors the document
and is the only place that defines these types; a unit test pins the error-code
list so a removed code fails a test rather than drifting quietly.

### D3. Path handling lives in one module and runs before every provider call

`normalizePath` rejects rather than repairs: non-strings, a missing leading `/`,
`\`, NUL, control characters, empty segments (`//`), `.`, `..`, trailing `/`
outside the root, segments over 255 bytes and paths over 4096 bytes. It never
percent-decodes. The result is canonical, so containment is a property of the
normalized path rather than a string prefix check.

Reserved paths are checked after normalization. `/exo.json` is compared
case-insensitively when `capabilities().caseSensitive` is false, and the prefix
`/.exo` is matched as a segment, not as a string prefix. The plugin facade filters
reserved entries from `list`, denies `stat`, `read`, `write`, `mkdir` and
`remove` on them, and denies a `move` whose source or destination is reserved.
The shell sees them normally so layer 3 can read and rewrite `exo.json` through
the same session.

### D4. Folder provider: inject the picker, the store and the platform facts

`FolderWorkspaceProvider` takes `{ picker, handleStore, platform }` with browser
defaults. `open()` calls `showDirectoryPicker({ mode: 'readwrite', id:
'exo-workspace' })` and maps `AbortError` to `aborted`; a `SecurityError` is a
real failure, a missing API is the unsupported state. The handle is written to
IndexedDB before the session is announced.

`restore(id)` reads the stored record, queries `readwrite` permission, falls back
to querying `read`, and returns a handle whose capabilities say `writable: false`
when only read is available. If read is not even granted, the handle is still
returned read-only: the first operation fails with `permission-denied` and the UI
offers the gesture-bound `requestPermission()`. This keeps the restore path free
of permission prompts. The descriptor id is `folder:<root name>` and the provider
kind is `folder`, matching the contract's "derived from name and provider" rule;
only one handle is stored, so a same-name folder replaces the record rather than
creating a second workspace.

`caseSensitive` is derived from the platform string (Windows and macOS are
treated as case-insensitive, Linux as case-sensitive) because the API does not
expose it. The provider declares the result; the session enforces reserved names
with it. Tests inject both values.

File operations walk the directory tree with `getDirectoryHandle` and
`getFileHandle`; `list` uses the async directory iterator; file stats come from
`getFile()` (`lastModified:size` version); writes use `createWritable()` and
re-stat. `ifVersion` is enforced by re-statting immediately before the writable
opens, matching the contract's documented narrow race. `move` uses the handle's
`move(destinationDirectory, newName)` where available and reports `unsupported`
otherwise; the explorer only renames within a parent, so the common path is
covered.

Aborting before a provider call rejects with `aborted`; aborting during a
non-abortable browser call lets the browser call finish but the session drops the
result when it checks the signal/generation. Writes can therefore complete after
an abort; the UI never observes them because the generation is gone. This is
documented as a provider limitation, not hidden.

`handle-store.ts` is a small IndexedDB wrapper: database `exo-workspace`, store
`handles`, key `last`, value `{ id, name, handle }`. It is the only place a
`FileSystemDirectoryHandle` is persisted; `localStorage` never sees one. A
storage failure degrades to a non-persistent session with a visible warning
rather than blocking the click that opened the folder.

### D5. Memory provider is the test oracle, not a fake workspace

The memory provider is deterministic: an in-memory tree, a per-file monotonic
version (`m1`, `m2`, …), an injected clock for `mtime`, synchronous watch
delivery in operation order, and the same error codes. It is imported by tests
and by the conformance suite only; the app entry point never imports it, so it
is not in the production bundle.

The roadmap's phrase "used by tests and by unsupported browsers" conflicts with
the ratified requirement that unsupported browsers get an explicit state and no
mock tree. The spec wins: Firefox and Safari get the unsupported state. The
memory provider is not auto-mounted anywhere.

### D6. The session owns refresh, generation and dispose

For a provider with `watchable: true`, the session subscribes through
`handle.watch(paths, onChange)` and forwards changes. For the folder provider it
registers `focus` and `visibilitychange` listeners on an injected `EventTarget`
(default `window`) while at least one document is tracked. Focus triggers at
most one in-flight refresh; a second focus is coalesced. Each tracked path is
re-stat'ed, compared with the loaded version, and reported as `changed` or
`deleted`; the tracked version is updated after the callback so a dirty document
is not re-notified on every focus. A path that reappears after deletion is a
`created`/`changed` result, not a silent success.

Every public operation captures `generation` and an `AbortSignal` before its
first await. After the await, a changed generation or an aborted signal throws
`aborted` and no callback runs. `dispose()` increments the generation, aborts
controllers, removes listeners and watch subscriptions, clears trackers and
resolves immediately on a second call. The controller calls `session.dispose()`
and then `provider.dispose()`.

### D7. Controller snapshot and React integration

The controller exposes:

```ts
type WorkspacePhase = 'starting' | 'restoring' | 'ready' | 'unsupported' | 'failed'

interface WorkspaceSnapshot {
  phase: WorkspacePhase
  generation: number
  descriptor?: WorkspaceDescriptor
  capabilities?: WorkspaceCapabilities
  error?: { code: WorkspaceErrorCode; path?: WorkspacePath }
  restoreAvailable: boolean
  writable: boolean
}
```

`start()` detects support, creates the folder provider, calls `restore()` and
publishes `ready` or `starting` with no workspace. `openFolder()` calls the
picker, disposes the old session/provider, increments the generation, clears
workspace-scoped shell state and publishes the new descriptor. `requestPermission()`
delegates to the session from the click handler and republishes capabilities.

`App` wraps the preset in a context provider and keys the explorer and document
area by `generation`. A switch therefore discards component-local caches by
unmounting them; no cleanup callback runs after the new workspace mounts.

### D8. Preset store: narrow persistence, one tab adapter, one close guard

`apps/shell/src/workbench/tabs.ts` is the only module that writes preset tab
state. It does three things:

1. **Narrows persistence.** `configurePresetStore()` calls
   `useWorkbenchStore.persist.setOptions({ partialize })` and persists only the
   theme, visibility flags, panel-maximized flag, sash sizes and active views.
   Tabs, closed-tab history, quick-open state, output and notifications are
   workspace- or session-scoped and are not persisted. This keeps the layout
   requirement and prevents a tab from folder A reappearing over folder B after
   a reload. It is idempotent and runs before the first render. The kit's
   persist types describe the wider object, so the adapter returns the narrower
   runtime value behind an explicit cast; a reload test proves the omitted tab
   fields fall back to their empty defaults.
2. **Mirrors document state.** Tabs are `kind: 'file'` with `path` as the id.
   Opening, activating, updating a renamed path and marking dirty/clean go
   through this adapter. The kit has no `markTabDirty`, so dirty updates use
   `useWorkbenchStore.setState` on the tab array, which is public store state.
3. **Guards close.** It wraps `closeTab`, `closeOtherTabs` and `closeAllTabs` in
   the preset store. Clean targets proceed immediately; dirty targets pause in a
   shell dialog offering Save/Discard/Cancel, and the original action runs only
   after every dirty document in the target set is resolved. The wrapper is
   installed once and removed on app unmount. A test closes a dirty tab with the
   guard removed and fails the "tab remains" assertion, so removing the guard
   breaks the suite.

Alternative rejected: switching to the kit's composition level to own the tab
strip. It would duplicate the preset store, lose layout persistence and turn
layer 2 into a shell rewrite. The wrapper uses the public store API and is
covered by a kit-upgrade verification task.

### D9. Explorer is a shell-owned React tree

The explorer is built from React and the kit's public `ContextMenu` primitive; no
new tree dependency and no fork of the preset. State is component-local and dies
with the generation key: loaded children by directory, expanded set, selection,
inline-edit state, per-directory errors and loading flags.

- Root lists on `ready`; directories list lazily on expand. Children sort
  directories before files, then `localeCompare` with the provider's case rule.
- `exo.json` and `.exo` are filtered out of the visible tree. Layer 3 will surface
  the declaration through settings; layer 2 neither shows it as editable nor
  offers it as a document.
- Create, rename and delete use a shell-owned prompt/confirmation and the
  session. Names are validated by the same normalization rules; a failed
  operation shows the mapped code next to the entry, not as a toast.
- Directory delete asks for confirmation and removes recursively; a dirty open
  file inside the target is confirmed once more through the delete dialog.
- Read-only sessions disable New/Rename/Delete and show a banner.
- `focus` and `visibilitychange` re-list expanded directories, coalesced per
  directory, without collapsing the tree.
- Keyboard: a roving tabindex over visible rows; Up/Down move, Right expands or
  enters, Left collapses or moves to the parent, Enter opens/expands, F2 starts
  rename, Delete opens confirmation, Home/End jump, Escape cancels inline edit.
  Focus is re-anchored to the nearest sibling or parent after a removal.
- Right-click and the context-menu key open the same actions. The preset's
  `onRevealFile` callback selects and expands the path.

### D10. Documents: one shell surface, buffers outside the preset

The preset renders only the active tab, so document buffers live in a
`DocumentStore` owned by the runtime and keyed by path. A document record holds
`path`, `status`, `text`, `savedText`, `version`, `dirty`, `external`, `size` and
an error code. The store is cleared on workspace switch and on tab close.

Opening reads in this order: `stat` → size/limit check → `read({ maxBytes })` →
binary sniff on the first 8 KiB (NUL bytes) → fatal UTF-8 decode. The limit is
10 MiB; a 1 MiB file is the supported path. Files that are binary, undecodable or
over the limit render a no-editor state and are never saved by the text surface.

The editor is a textarea rendered from the buffer once per load, not a controlled
value on every keystroke: `onChange` updates the buffer and `dirty =
text !== savedText`, and only the dirty dot and save affordance subscribe to
those fields. This keeps a 1 MiB document responsive without introducing a code
editor dependency.

Save snapshots the text and loaded version, writes with `{ ifVersion }`, and
updates `version`, `savedText` and the tracked session version on success. If the
text changed while the write was in flight, the document stays dirty. A
`conflict` sets the external-change notice and leaves the disk content and local
edits intact. A missing file surfaces `not-found` and is not recreated.

Rename updates the buffer key, tab path/title and loaded version from the
`move()` result; dirty content follows the file. Delete aborts an in-flight save,
drops the buffer and closes the tab; a later save cannot target it.

### D11. Close, unload and switch protection

The close guard resolves each dirty document with the same Save/Discard/Cancel
dialog used by the tab strip. Save-then-close reuses the document save path; a
failed save keeps the tab open and dirty. Discard drops the buffer and closes.
Cancel restores focus to the tab.

`beforeunload` is registered while any document is dirty and calls
`preventDefault()` with `returnValue` set for compatibility. A workspace switch
runs the same guard before it disposes the old session; if the user cancels, the
switch is cancelled before the old provider is touched.

### D12. External changes and conflict UX

The session pushes external changes to the runtime, which updates the document
record. A clean document shows "Changed on disk" with Reload; reload replaces
the buffer and baselines. A dirty document shows "Changed on disk — saving will
conflict" and keeps local edits; the reload action is available but confirms
that local edits will be lost. A deleted document shows a deleted notice with no
save action. Permission failures during refresh set the workspace banner instead
of replacing the document.

### D13. Errors are scoped and mapped in one place

`WorkspaceError` carries a stable code, an optional path and a cause. The UI maps
codes to text through `workspaceErrorMessage(code, path)`; provider messages and
stack traces never reach the DOM. Explorer errors live in the directory node,
document errors in the tab, permission errors in the workspace banner, and the
status bar carries the workspace name and read-only state. Global notifications
are not used for workspace failures.

### D14. Commands are filtered, not disabled

The command registry is a small object that computes `list()` from the current
snapshot: Open Folder is always present; Save, New File, New Folder and Refresh
are present only when a workspace or active document makes them meaningful.
`run()` re-checks the same predicate, so a stale palette entry cannot start an
invalid operation. Menus keep stable entries; running an inapplicable one is a
no-op. `Ctrl/Cmd+S` is a shell key listener that saves the active text document
and prevents the browser's save dialog.

### D15. Verification strategy

| Layer | Tests |
| --- | --- |
| Paths | Table-driven normalization, reserved case folding, containment, segment limits |
| Session | `forPlugin` denial vs shell access, reserved listing filter, `ifVersion` conflict, abort, idempotent dispose, late callback dropped |
| Providers | One conformance suite run against memory and folder providers; folder provider also against a fake FSA directory tree |
| Persistence | IndexedDB round-trip with `fake-indexeddb`; localStorage never contains a handle; missing record clears |
| Controller | Restore, open, cancel, switch, permission escalation, generation-keyed reset |
| Tabs | Partialize excludes tabs; dirty adapter; close guard blocks dirty close; unload warning |
| Documents | Open/save round-trip, dirty, conflict, binary/oversized/undecodable, rename, delete, in-flight save cancellation |
| Explorer | Render, lazy expand, keyboard operations, reserved filtering, read-only, inline errors |
| Commands | Palette omits Save with no document and includes Open Folder without a workspace |

jsdom cannot exercise the real picker or permission prompts. The folder provider
tests use a fake directory handle that implements the same surface; the real
browser path is a manual Chromium smoke pass (1 MiB open/edit/save, reload and
restore, deny write permission, rename/delete an open file). The memory provider
and conformance suite are the automated oracle.

## Risks / Trade-offs

- [The close guard wraps preset store actions that are not a documented close
  hook] → Pin `~0.1.3`, test the guard and the unguarded failure, and re-verify
  the store surface when the kit minor changes.
- [Changing the preset's `partialize` narrows persistence beyond the kit's
  default] → Only workspace-scoped tab fields are removed; layout and theme
  round-trips are already tested. Record the reason next to the adapter.
- [File System Access has no atomic compare-and-swap] → Re-stat immediately
  before `createWritable`, return `conflict` on a mismatch, keep the tab dirty,
  and document the narrow race in the workspace contract.
- [Permission behavior differs across Chromium versions and platforms] → Query
  read and readwrite separately, keep the read-only banner and gesture-bound
  request, and test both fake states.
- [Directory `move` is not available everywhere] → Use it when present, return
  `unsupported` otherwise; the explorer only renames within a parent.
- [Abort cannot cancel a browser write already in flight] → Generation checks
  drop the result and the UI never observes it; the provider limitation is
  documented.
- [A 10 MiB textarea is not a code editor] → The surface is deliberately minimal
  for layer 2; Monaco is a plugin in layer 9. The uncontrolled input avoids
  per-keystroke re-renders.
- [Large directories can render many rows] → Lazy listing and expansion bound
  the first render; virtualization is a hardening-layer measurement, not a
  layer 2 promise.
- [The fake FSA backend can diverge from Chromium] → Conformance plus the manual
  smoke checklist, and keep the fake limited to the methods the provider uses.
- [Workspace tabs no longer survive a reload] → The layout spec does not require
  tab restoration, and persisting tabs would leak a tab across workspaces; the
  behavior is recorded in the adapter and the release notes.

## Migration Plan

No data migration. A new IndexedDB database is created on first use, and the
existing `desktop-ui-template:v1` envelope keeps its layout fields; its tab
fields are simply no longer written. Rolling back restores the previous build,
which ignores the new handle record. No backend or deployment topology changes:
the shell remains a static Pages build.

## Open Questions

None that block implementation. The 10 MiB text limit and the platform
case-sensitivity heuristic are constants that can change without a spec change;
the manual Chromium pass records the exact browser version used for the exit
criteria.
