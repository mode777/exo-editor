# Workspace Access Contract (v1)

Status: ratified by the OpenSpec change `define-core-contracts`. Normative
requirements are mirrored in `openspec/specs/workspace-access/spec.md`.

## 1. Purpose

The shell owns the user's files. Everything else - explorer, document views,
plugin file requests, save - goes through one session object. Providers are
interchangeable backends; the session is the only place that knows whether a
workspace is a picked folder, an in-memory fixture or a future remote store.

Rules that hold for every provider:

1. A plugin never receives a `FileSystemHandle`, a `Blob` of arbitrary scope, or
   any object whose methods can reach outside the workspace root.
2. Paths are workspace-relative, POSIX-style and normalized by the session. The
   root is `/`.
3. Every asynchronous filesystem operation accepts an `AbortSignal` and rejects
   with a `WorkspaceError` when aborted.
4. Reads and writes are byte-oriented. Text decoding belongs to the caller.
5. Writes are isolation-safe: a stale write must fail with `conflict` rather
   than overwrite a newer version.

## 2. Types

```ts
/** Absolute, '/'-rooted, normalized. Never contains '.', '..' or empty segments. */
export type WorkspacePath = string

export type WorkspaceErrorCode =
  | 'not-found'
  | 'not-a-file'
  | 'not-a-directory'
  | 'already-exists'
  | 'permission-denied'
  | 'conflict'
  | 'quota-exceeded'
  | 'unsupported'
  | 'too-large'
  | 'aborted'
  | 'io'

export interface WorkspaceCapabilities {
  /** Provider can create, write, move and delete. */
  writable: boolean
  /** Provider can report external changes. When false the shell polls on focus. */
  watchable: boolean
  /** Handle or identity survives a page reload. */
  persistent: boolean
  /** Paths are compared case-sensitively. */
  caseSensitive: boolean
  /** Maximum bytes accepted by one read or write. */
  maxFileSize?: number
}

export interface FileStat {
  path: WorkspacePath
  kind: 'file' | 'directory'
  /** Bytes for files, 0 for directories. */
  size: number
  /** Epoch milliseconds. */
  mtime: number
  /**
   * Opaque content version. Must change whenever content or mtime changes and
   * must be stable for unchanged content. Used as the write precondition.
   */
  version: string
}

export type WorkspaceChange =
  | { kind: 'created'; path: WorkspacePath; stat: FileStat }
  | { kind: 'changed'; path: WorkspacePath; stat: FileStat }
  | { kind: 'deleted'; path: WorkspacePath }
  | { kind: 'renamed'; path: WorkspacePath; previousPath: WorkspacePath; stat: FileStat }

export interface WorkspaceDescriptor {
  /** Stable within one provider. Not a secret: derived from name and provider. */
  id: string
  /** Display name, usually the folder name. */
  name: string
  providerKind: string
  capabilities: WorkspaceCapabilities
}

export interface ReadOptions {
  signal?: AbortSignal
  /** Reject with 'too-large' instead of reading beyond this many bytes. */
  maxBytes?: number
}

export interface WriteOptions {
  signal?: AbortSignal
  /** Reject with 'conflict' when the current version differs. */
  ifVersion?: string
  /** Create parent directories. Default false. */
  create?: boolean
}

export interface ListOptions {
  signal?: AbortSignal
  /** 'one' for direct children only; 'recursive' for a full subtree. Default 'one'. */
  depth?: 'one' | 'recursive'
}

export interface Disposable {
  dispose(): void
}
```

```ts
export interface WorkspaceProvider {
  readonly kind: string
  readonly label: string

  capabilities(): WorkspaceCapabilities

  /** Show the backend's picker or otherwise establish a new workspace. */
  open(options?: { signal?: AbortSignal }): Promise<WorkspaceHandle>

  /** Re-open a previously persisted workspace. Return null when unavailable. */
  restore?(id: string, options?: { signal?: AbortSignal }): Promise<WorkspaceHandle | null>

  /** Release provider resources. No operation may be served afterwards. */
  dispose(): void
}

export interface WorkspaceHandle {
  descriptor: WorkspaceDescriptor

  list(path: WorkspacePath, options?: ListOptions): Promise<FileStat[]>
  stat(path: WorkspacePath, options?: { signal?: AbortSignal }): Promise<FileStat>
  read(path: WorkspacePath, options?: ReadOptions): Promise<Uint8Array>
  write(path: WorkspacePath, data: Uint8Array, options?: WriteOptions): Promise<FileStat>
  mkdir(path: WorkspacePath, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<void>
  remove(path: WorkspacePath, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<void>
  move(from: WorkspacePath, to: WorkspacePath, options?: { overwrite?: boolean; signal?: AbortSignal }): Promise<FileStat>

  /**
   * Optional. Request read-write permission from a user gesture and return the
   * updated capabilities. Absent when the provider cannot escalate permission.
   */
  requestPermission?(options?: { signal?: AbortSignal }): Promise<WorkspaceCapabilities>

  /** Optional. Absent when capabilities().watchable is false. */
  watch?(paths: WorkspacePath[], onChange: (change: WorkspaceChange) => void): Disposable
}
```

```ts
export interface OpenDocumentSnapshot {
  path: WorkspacePath
  /** The version the shell loaded; refresh compares against this. */
  version: string
}

export interface WorkspaceAccess {
  list(path: WorkspacePath, options?: ListOptions): Promise<FileStat[]>
  stat(path: WorkspacePath, options?: { signal?: AbortSignal }): Promise<FileStat>
  read(path: WorkspacePath, options?: ReadOptions): Promise<Uint8Array>
  write(path: WorkspacePath, data: Uint8Array, options?: WriteOptions): Promise<FileStat>
  mkdir(path: WorkspacePath, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<void>
  remove(path: WorkspacePath, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<void>
  move(from: WorkspacePath, to: WorkspacePath, options?: { overwrite?: boolean; signal?: AbortSignal }): Promise<FileStat>
}

export interface WorkspaceSession extends WorkspaceAccess {
  /** Snapshot taken when the session was created; capabilities() is authoritative. */
  readonly descriptor: WorkspaceDescriptor

  capabilities(): WorkspaceCapabilities

  /** Plugin-scoped facade. Applies the reserved-path guard and logs denials. */
  forPlugin(pluginId: string): WorkspaceAccess

  /** Gesture-bound permission escalation. Returns the updated capabilities. */
  requestPermission(options?: { signal?: AbortSignal }): Promise<WorkspaceCapabilities>

  /** Replace the tracked open-document set used by the refresh fallback. */
  setOpenDocuments(documents: OpenDocumentSnapshot[]): void

  /** Re-stat tracked documents and return only the changes. */
  refreshOpenDocuments(): Promise<WorkspaceChange[]>

  onExternalChange(listener: (change: WorkspaceChange) => void): Disposable

  dispose(): Promise<void>
}

export interface WorkspaceLogEntry {
  at: number
  operation: 'list' | 'stat' | 'read' | 'write' | 'mkdir' | 'remove' | 'move' | 'permission'
  pluginId?: string
  path?: WorkspacePath
  code?: WorkspaceErrorCode
}
```

`WorkspaceSession` is the shell-facing wrapper. It adds the workspace-scoped
behaviour that providers do not own: path normalization, containment, the
reserved-path guard, the operation log used for diagnostics, the polling
fallback, permission escalation and the reset lifecycle described in section 7.

Shell-originated calls on the session are unrestricted except for normalization.
`forPlugin(pluginId)` returns a facade over the same rules; every call through it
is checked against the reserved set and logged with the plugin id. The facade
cannot widen access and never receives a handle.

`descriptor.capabilities` is a snapshot from open or restore. A successful
`requestPermission()` may make a workspace writable; callers use
`capabilities()` for the current state. The session replaces its descriptor
snapshot when that happens.

## 3. Path rules

- Paths are `/`-rooted and `/`-separated. Backslashes are rejected, not
  normalized, so a Windows separator bug is visible.
- Normalization rejects `..`, `.`, empty segments, `//`, trailing `/` (except
  the root `/`), NUL, control characters, and any segment longer than 255 bytes.
- Comparison uses the provider's `caseSensitive` flag. On a case-insensitive
  provider, `exo.json` and `EXO.JSON` are the same reserved path.
- Paths are **not** URLs: no percent-decoding, no query strings, no fragments.
- Relative paths are resolved by the shell before reaching the provider. The
  plugin protocol resolves relative requests against the handler file's
  directory; providers never see relative input.

## 4. Reserved paths

The session refuses to serve these to plugin-originated requests, regardless of
provider permissions:

| Path | Reason |
| --- | --- |
| `/exo.json` | Plugin configuration; plugins must not read or edit it |
| `/.exo/**` | Shell-owned workspace metadata |

The shell itself may read and write `exo.json`. There is no API that lets a
plugin write it, and no message exists that names it as a save target.
`forPlugin(pluginId)` is the only plugin-facing path: it filters reserved entries
from listings, denies reserved reads, writes, stats, directory creation, removal
and moves, and records the plugin id and code in the session log.

## 5. Errors

`WorkspaceError extends Error` carries `code: WorkspaceErrorCode`, `path?` and
`cause?`. Mapping rules:

| Situation | Code |
| --- | --- |
| Missing path | `not-found` |
| Wrong kind (`read` on a directory, `list` on a file) | `not-a-file` / `not-a-directory` |
| `mkdir`/`move` without overwrite onto an existing path | `already-exists` |
| Provider permission not granted | `permission-denied` |
| `ifVersion` mismatch | `conflict` |
| Path traversal, reserved path or a path the caller may not see | `permission-denied` |
| Operation exceeds `maxFileSize` | `too-large` |
| Backend cannot express the operation | `unsupported` |
| `AbortSignal` fired | `aborted` |
| Anything else from the backend | `io` |

The shell maps these to user-facing text; plugins only ever see the protocol
error codes (`not-found`, `permission-denied`, `too-large`, `conflict`,
`unsupported`, `internal`). Stack traces and provider messages never cross into a
plugin frame.

## 6. Provider requirements

### Folder provider (File System Access API)

- `open()` calls `showDirectoryPicker({ mode: 'readwrite' })` from a user
  gesture. A picker cancellation rejects with `aborted`, not `io`.
- `capabilities()` returns `{ writable: true, watchable: false, persistent: true,
  caseSensitive: <platform> }`. The API has no change notifications, so the
  session polls visible directories and re-stats open documents on window focus
  and on `visibilitychange`.
- The `FileSystemDirectoryHandle` is stored in IndexedDB. It is structured-
  cloneable but not JSON-serializable; `localStorage` cannot hold it.
- After reload, `queryPermission({ mode: 'readwrite' })` decides whether to
  restore silently. `requestPermission` must run in a user gesture; until it
  does, the workspace is restored read-only and the UI offers "Restore access".
  The handle exposes `requestPermission()` for that gesture; it returns the
  updated capabilities and rejects with `unsupported` when the provider cannot
  escalate.
- Writes use `createWritable()`, write, close. `ifVersion` is enforced by
  re-statting immediately before opening the writable and comparing `version`;
  the API offers no atomic compare-and-swap, so the window is narrow but real and
  documented.
- `version` is `${lastModified}:${size}`. It is opaque to callers and is not a
  content hash.

### Memory provider

Required for tests as the reference implementation and deterministic oracle; it
is not mounted as a fallback for unsupported browsers:

- Deterministic, synchronous-backed, no persistence, `watchable: true`,
  `persistent: false`, `caseSensitive: true`, `writable: true`.
- `version` is a monotonic counter per file (`m1`, `m2`, ...); `mtime` comes from
  an injectable clock. The same operation sequence always produces the same stats.
- Watch callbacks are delivered in operation order; aborting an operation never
  emits a change.
- Exposes the same error codes, including `conflict`.
- Used by contract tests for the session, the plugin broker and the save flow, so
  it is the reference implementation of this contract and the test oracle for the
  folder provider.
- A browser without the File System Access API gets an explicit unsupported
  state, never a memory-backed mock workspace.

### Stratofold provider (remote)

`StratofoldWorkspaceProvider` (`kind: 'stratofold'`) maps one Stratofold vdir to
one workspace. `@stratofold/client` is pinned exactly; the mapping, the residual
gaps and the upstream asks live in
[`../providers/stratofold.md`](../providers/stratofold.md).

- `open()` is the connect flow, not a picker. The shell accepts a server URL plus
  a token, an `sfconn_v1_` connection string, or a public directory id. A
  connection string is parsed locally into server, directory and token before
  any request; a malformed value is rejected without mounting. The shell then
  validates the connection against the server before a handle exists: a token's
  scope is resolved with `tokenInfo()` and a public directory with an initial
  `list("")`. A connection that fails validation produces no handle.
- The connection-string value is a bearer-equivalent secret. It is parsed and
  discarded, never sent to the server, and never stored, logged or exposed to a
  plugin. The editable server field is the origin override for a stale embedded
  URL; the directory and token still come from the string.
- `capabilities()` is `writable` only for an `editor` credential, `watchable:
  false`, `caseSensitive: false` (the server exposes no case capability, so
  `EXO.JSON` and `.EXO/**` are treated as reserved), `persistent` only when the
  user opted to remember the connection, and no `maxFileSize` because the
  server's limit is not discoverable.
- `version` is the server's opaque content version. `ifVersion` becomes a
  conditional upload; a mismatch rejects with `conflict` and no publish.
- A zero-length write is an ordinary write: it creates an empty file or replaces
  existing content, returns the new metadata and rotates the version. This needs
  a Stratofold 0.12.0 or newer server; an older server reports the empty upload
  as `io`.
- A public connection and a `viewer` credential are read-only. The session
  rejects writes with `unsupported` before any request.
- The credential is shell-owned: header-only transport, never a URL, a bundle
  entry, the workspace log or a plugin message. It is stored only after an
  explicit opt-in and is deleted by "forget", "disconnect" or a failed
  reconnect. A connection supplied as a connection string is stored as its
  decomposed server, directory, name, role and token fields; the raw string is
  never persisted. A session-only connection leaves no stored credential.
- A rejected, expired or revoked credential moves the workspace to an explicit
  reconnect state. The shell makes no further request until the user reconnects
  or disconnects, and it never retries silently or reports the failure as `io`.
- Reconnect is a workspace switch: the old session is disposed and the workspace
  is activated again, so no tab, cached content or loaded version survives it.
- The provider exposes no `fileUrl()` or `temporaryUrl()`; bytes move only
  through `read()` and `write()`.

### Provider selection

The runtime holds one provider entry per kind and opens exactly one workspace at
a time. A persisted workspace record carries its provider kind; restore uses that
kind and returns no workspace rather than mounting another provider's record. A
record written before provider selection existed is a folder workspace. A
browser without the File System Access API still reports the folder path as
unsupported, and may open a remote workspace.

### Future providers

OPFS, read-only bundles (for demos) and remote stores implement the same
interface. Anything that cannot honor a rule - for example a remote store without
conditional writes - must report `capabilities().writable === false` rather than
weaken the contract.

## 7. Session lifecycle (normative)

```text
select provider kind -> open/restore -> create session -> ready
ready -> switch request -> dispose session -> select provider kind -> open -> ready
ready -> credential rejected -> reconnect state -> reconnect or disconnect -> ready / no session
ready -> dispose -> no session
```

`open` differs by provider kind: a picker for a folder, a validated connection for
a remote workspace. A workspace switch is the same operation regardless of
whether the two workspaces use the same provider kind.

`dispose()` performs, in order:

1. Abort every in-flight operation and stop all watchers.
2. Dispose every plugin handler session, then every plugin registration (see
   [`plugin-protocol.md`](./plugin-protocol.md)).
3. Unsubscribe all event topics and reset per-workspace sequence numbers (see
   [`events.md`](./events.md)).
4. Clear caches, open tabs and workspace-scoped settings.
5. Release the provider (drop handles, stop polling).

Handler frames are therefore gone before the provider is released, and no
workspace event can be emitted while state is being cleared.

After `dispose()` resolves, no callback from the old workspace may mutate shell
state. Late callbacks are dropped by a generation counter captured at dispatch
time.

### Refresh and permission

The session tracks the open documents supplied through `setOpenDocuments()`
(path and loaded version). When the provider declares `watchable: false`, the
session installs `focus` and `visibilitychange` listeners on its event target and
re-stats the tracked documents. It emits a `changed` or `deleted` result only
when the version, kind or existence differs, and checks the owning generation
before any callback. A watchable provider supplies changes through `watch()`
instead. `refreshOpenDocuments()` is the explicit form of the same operation.

`requestPermission()` delegates to the handle, updates the session's capability
snapshot and returns the new capabilities. It is intended to be called only from
a user gesture. A denial leaves the workspace read-only; a provider without the
operation rejects with `unsupported`.

## 8. Out of scope for v1

- Multi-root workspaces.
- File watching through a browser API (the folder provider polls).
- Atomic multi-file transactions.
- Symlink handling: the folder provider resolves within the picked tree and
  rejects escapes reported by the platform.
- Quotas, trash/restore, and conflict-resolution UI beyond a save error.
