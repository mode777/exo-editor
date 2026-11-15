# Design

## Context

See `proposal.md` for motivation and the two delta specs for required behavior.
The current store (`providers/stratofold/connection-store.ts`) opens
`exo-remote` version 1 with one out-of-line `last` record and a `get/put/clear`
interface. `StratofoldSource` owns connect, restore, peek and forget; the runtime
owns activation and the active-workspace marker. The connect dialog currently
exposes a `remember` checkbox, and the settings surface labels a remembered
connection. Tokens are already shell-owned and absent from the snapshot, plugin
host state and plugin config state.

## Goals / Non-Goals

**Goals:**

- Keep every validated connection in one ordered, bounded list and make
  reopening or removing an entry a shell operation, not a new provider API.
- Preserve the existing trust boundary: IndexedDB only, no token in URLs, DOM,
  snapshots, logs, plugin state or `localStorage`.
- Make the active workspace restore path and the manual recents path share the
  same validation and reconnect behavior.
- Migrate the existing single record without a user-visible loss.

**Non-Goals:**

- Encryption at rest, per-entry biometric or OS-keychain protection, sync or
  export of the list, token refresh/rotation, and a recents list for folders.
- Changing `WorkspaceProvider`, `WorkspaceHandle` or the Stratofold client.
- Keeping a "session-only" switch alongside automatic persistence.

## Decisions

### Decision 1: IndexedDB v2, keyed by workspace id, sorted on read

Keep the existing `exo-remote` database and `connections` store, bump the
version to 2, and write records with an out-of-line key equal to
`stratofoldWorkspaceId`:

```ts
interface StoredConnectionRecord {
  id: string
  connection: StratofoldConnection
  lastOpenedAt: number
}
```

`list()` reads all records and sorts by `lastOpenedAt` descending; `put()`
writes, trims to `MAX_RECENT_CONNECTIONS = 10`, and deletes the oldest extras in
the same readwrite transaction. The list is small, so an index and cursor are
unnecessary. The v1 `last` record is read in `onupgradeneeded`, given
`lastOpenedAt: 0`, written under its `id`, and the old key is deleted.

Alternatives: creating a second `recent` store leaves two sources of truth;
using `localStorage` cannot safely hold the structured record and is already
reserved for consent/layout state. A `lastOpenedAt` index adds a schema object
without a measurable win at ten entries.

### Decision 2: Persist before mount, but never block a workspace on storage

`StratofoldSource.connect` validates first, then attempts the `put`, then builds
the provider with `persistent` set to the write result and opens it. A storage
failure therefore produces a working session-only workspace and a visible
"not stored" state instead of a failed connection. The record is written only
after validation, so a wrong token never enters the list. `restore` refreshes
the entry's `lastOpenedAt` after a successful revalidation.

Alternative: treating a storage failure as fatal would make private-mode or
quota-limited browsers unable to use remote workspaces, which is a regression
from the old session-only path.

### Decision 3: One record per workspace identity, token replacement on reconnect

The key is the same identity the provider already exposes. Connecting the same
server-plus-directory with a new role/token replaces the record and moves it to
the top; it never creates a duplicate. A public connection for the same identity
replaces a token record with a tokenless one. A failed validation never touches
the existing record. A rejected stored token stays in the list so the user can
reconnect or remove it; rejection is not deletion.

### Decision 4: Disconnect and remove are separate actions

`disconnect()` releases the session and clears the active marker but leaves the
recent entry. Removing an entry calls the store's `remove(id)`; if that entry is
active, the runtime disconnects first and then deletes it. The connect dialog
shows a Remove action per row, and the Workspace settings section offers a
"Remove from Recent Workspaces" action for the active connection. Both actions
go through the existing dirty-document guard, so removing an active workspace
cannot discard unsaved edits silently.

The old "Disconnect and forget" label and the `remember` checkbox are removed.
The dialog instead states that connections and tokens are kept in this browser
and can be removed.

### Decision 5: Recents are fetched on demand, not stored in the snapshot

The dialog calls `runtime.listRemoteConnections()` when it opens and keeps the
result in local component state. The runtime snapshot keeps only the active
connection summary (now including `id` and `stored`). This avoids broadcasting
the whole list through every snapshot update and keeps the token-bearing store
behind an explicit runtime method. A remove action refreshes the local list.

### Decision 6: Manual recents reuse the connect path; startup restore uses restore

`openRemoteRecent(id)` reads the stored connection through the source, then calls
the same `connectRemote` validation/persist/activation path with the stored
server, token and directory. This gives identical validation, error reporting,
last-opened updates and token replacement. The startup path still uses
`source.restore(id)` because the active marker already names the entry and no
current workspace exists; it revalidates and returns a provider without
re-persisting through the connect form.

### Decision 7: UI disclosure and removal are part of the security boundary

Automatic persistence is a deliberate trade for convenience. The connect dialog
must say that the token stays in this browser, the active settings surface must
show whether the connection is stored, and every stored entry must be removable.
The token is never included in `RemoteWorkspaceSummary`; only the store and the
source see it. This keeps the existing "credential never reaches a plugin or the
snapshot" tests meaningful after the default changes.

## Risks / Trade-offs

- **Token at rest in IndexedDB** -> Any script running on the shell origin can
  read it. The mitigation is the existing no-backend/no-inline-script posture,
  CSP, shell-owned credential handling, explicit UI disclosure and per-entry
  removal. Encrypting with a key stored beside the ciphertext would not add
  protection against that threat.
- **Revoked tokens clutter the list** -> Revalidation on open surfaces the
  explicit reconnect state; the entry stays until the user removes it, so a
  revoked token is never silently mounted or silently deleted.
- **Storage quota or private mode** -> The workspace still mounts session-only
  and the UI reports it is not stored; no partial record is treated as
  restorable.
- **Schema rollback** -> Old code opening a v2 database requests version 1 and
  receives `VersionError`; the store maps that to `unsupported`, so remote
  workspaces still open session-only. A rollback should clear `exo-remote` or
  ship a v2-aware reader.
- **Migration race** -> The upgrade runs in one IndexedDB transaction; if it
  aborts, the database stays at v1 and the store reports storage unavailable
  rather than losing the old record.
- **Bundle budget** -> The dialog list and settings action add UI code; measure
  the deployed bundle and raise the js limit only if the measured value exceeds
  the current one, recording the measured number and headroom in the change.
- **Recents reveal workspace names to anyone at the unlocked browser** ->
  Acceptable for a local-first editor; the list is not exported and contains no
  raw connection string.

## Migration Plan

1. Ship the v2 store and UI together; the first open upgrades `exo-remote` in
   place and migrates `last` to a keyed record.
2. Existing active markers are already `stratofold:<origin>:<vdir>` and match
   the new key, so the first reload restores the migrated entry.
3. No server-side migration or deployment step is needed; the static site
   deploys through the normal CI gate.
4. Rollback is code-only but requires clearing `exo-remote` or accepting
   session-only connections, as described in the risks.
