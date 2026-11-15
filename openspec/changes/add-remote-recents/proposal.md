# Proposal

## Why

The shell keeps at most one Stratofold connection and only when the user ticks a
"remember" box. A user with more than one vdir must retype the server and token
every time, and the previous connection is silently discarded by a later one.
The provider already has a validated, shell-owned connection object; keeping a
short, ordered list of them makes reopening a workspace one click without
weakening the rule that the token stays inside the shell.

## What Changes

- Replace the single `last` connection record with a keyed recent-workspaces
  list in the existing `exo-remote` IndexedDB database (schema version 2),
  ordered newest first and capped at ten entries. The upgrade migrates a v1
  `last` record instead of dropping it.
- **BREAKING** Store every successfully validated connection, including its
  token, automatically. The "Remember this connection" opt-in and the
  session-only default are removed, and the connect UI states that the token is
  kept in this browser. A public directory is stored without a credential.
- Show the recent list in the connect dialog. Opening an entry revalidates the
  stored connection before mounting it; removing an entry deletes that record
  and its token. A failed entry stays listed so the user can reconnect it with a
  new token.
- Change disconnect semantics: disconnecting releases the workspace and clears
  the active marker but keeps the recent entry and its token. "Remove from
  recent workspaces" or the dialog's remove action is the explicit forget.
- Restore the active workspace by its stored id rather than comparing against a
  single record, and refresh that entry's last-opened time on a successful
  restore or reconnect.
- Keep the credential shell-owned: the snapshot carries only server, directory,
  name, role, id and timestamps, never a token. The raw `sfconn_v1_` value is
  still decomposed and discarded, never persisted, and the store stays
  IndexedDB rather than `localStorage`.
- Add store, runtime, dialog and settings tests, including the v1 migration,
  ordering, cap, per-entry removal, disconnect retention, token absence from the
  snapshot and plugin state, and a recents UI that never renders a token.
- Update `docs/contracts/workspace-api.md`,
  `docs/providers/stratofold.md` and `ROADMAP.md` (new provider-track item P3).

**Explicit non-goals:** syncing or backing up connections to a server, sharing
them between browsers or profiles, encrypting IndexedDB, token rotation or
expiry management, a quick-open equivalent for recents, folder-workspace
recents, and changing the Stratofold client or provider contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `remote-workspace`: replace the explicit-opt-in/single-record persistence
  requirement with automatic persistence of every validated connection and an
  ordered recent-workspaces list that can be reopened and removed per entry;
  disconnect no longer implies forgetting.
- `workspace-access`: a remote provider restores the active connection from the
  stored recent list instead of only a connection the user explicitly opted to
  remember.

## Impact

- `apps/shell/src/workspace/providers/stratofold/connection-store.ts`: v2
  schema, keyed records, ordering, cap, migration, per-entry removal; the memory
  store mirrors the same interface.
- `apps/shell/src/workspace/providers/stratofold/source.ts`: automatic persist
  on connect, restore by id, list and remove.
- `apps/shell/src/workspace/runtime.ts`: recent-list snapshot/API, open and
  remove actions, disconnect retention, active-marker restore by id.
- `apps/shell/src/workspace/ConnectRemoteDialog.tsx` and
  `apps/shell/src/settings/WorkspaceSettings.tsx`: recent list, remove action,
  storage wording and the removed remember checkbox.
- `apps/shell/src/App.tsx` and `apps/shell/src/settings/SettingsDialog.tsx`:
  wiring for the remove action.
- Tests in the store, source, runtime, App and settings suites; the fake server
  and provider tests do not need a protocol change.
- Docs: `docs/contracts/workspace-api.md`,
  `docs/providers/stratofold.md`, `ROADMAP.md`.
- Bundle budget: the dialog and list add UI code; measure and raise
  `apps/shell/budget.json` only if the measured bundle exceeds the current
  limit, recording the number and headroom.
