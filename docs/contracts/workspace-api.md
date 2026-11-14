# Workspace Access Contract (v1)

Status: draft - normative once the OpenSpec change `define-core-contracts` is
archived. Normative requirements are mirrored in
`openspec/changes/define-core-contracts/specs/workspace-access/spec.md`.

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
3. Every operation accepts an `AbortSignal` and rejects with a `WorkspaceError`
   when aborted.
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

  /** Optional. Absent when capabilities().watchable is false. */
  watch?(paths: WorkspacePath[], onChange: (change: WorkspaceChange) => void): Disposable
}
```

`WorkspaceSession` is the shell-facing wrapper. It adds the workspace-scoped
behaviour that providers do not own: the reserved-path guard, the operation log
used for diagnostics, the polling fallback, and the reset lifecycle described in
section 7.

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
- Writes use `createWritable()`, write, close. `ifVersion` is enforced by
  re-statting immediately before opening the writable and comparing `version`;
  the API offers no atomic compare-and-swap, so the window is narrow but real and
  documented.
- `version` is `${lastModified}:${size}`. It is opaque to callers and is not a
  content hash.

### Memory provider

Required for tests and for the "unsupported browser" state:

- Deterministic, synchronous-backed, no persistence, `watchable: true`.
- Exposes the same error codes, including `conflict`.
- Used by contract tests for the session, the plugin broker and the save flow.

### Future providers

OPFS, read-only bundles (for demos) and remote stores implement the same
interface. Anything that cannot honor a rule - for example a remote store without
conditional writes - must report `capabilities().writable === false` rather than
weaken the contract.

## 7. Session lifecycle (normative)

```text
create provider -> open/restore -> create session -> ready
ready -> switch request -> dispose session -> create provider -> open -> ready
ready -> dispose -> no session
```

`dispose()` performs, in order:

1. Abort every in-flight operation and watcher.
2. Notify the plugin host to tear down handler frames and registrations (see
   [`plugin-protocol.md`](./plugin-protocol.md)).
3. Clear caches, open tabs and workspace-scoped settings.
4. Release the provider (drop handles, stop polling).

After `dispose()` resolves, no callback from the old workspace may mutate shell
state. Late callbacks are dropped by a generation counter captured at dispatch
time.

## 8. Out of scope for v1

- Multi-root workspaces.
- File watching through a browser API (the folder provider polls).
- Atomic multi-file transactions.
- Symlink handling: the folder provider resolves within the picked tree and
  rejects escapes reported by the platform.
- Quotas, trash/restore, and conflict-resolution UI beyond a save error.
