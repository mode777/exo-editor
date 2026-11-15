# Tasks

## 1. Recent connection store

- [x] 1.1 Replace the single-record `ConnectionStore` with `list/get/put/remove/clear`, key records by workspace identity, sort newest first and cap the list at ten; verify the store unit tests cover round-trip, ordering, duplicate replacement, the cap and per-entry removal
- [x] 1.2 Upgrade `IndexedDbConnectionStore` to schema version 2 and migrate the v1 `last` record into a keyed entry in the same transaction; verify a test that seeds a v1 database opens it through the v2 store and finds the migrated connection
- [x] 1.3 Make `MemoryConnectionStore` implement the same ordering, cap and removal semantics; verify its tests match the IndexedDB behavior
- [x] 1.4 Verify a storage failure remains an `unsupported`/`io` `WorkspaceError` and never writes a partial record; run `npm test -- src/workspace/providers/stratofold/connection-store.test.ts`

## 2. Source and runtime

- [x] 2.1 Make `StratofoldSource.connect` persist every validated connection with a last-opened timestamp, return the stored state, and build the provider with the resulting `persistent` capability; verify tests cover token, public and storage-failure connections
- [x] 2.2 Add `list`, `get`/`peek` by id and `remove` to the source, and make `restore` read the record by id and refresh its timestamp; verify tests cover restore after reload, missing id and a rejected stored credential that remains listed
- [x] 2.3 Add runtime `listRemoteConnections`, `openRemoteRecent` and `removeRemoteConnection`; include `id`/`stored` in the active summary and restore the active marker by id; verify runtime tests cover opening a recent, removing one, removing the active one and a missing entry
- [x] 2.4 Change `disconnect()` to clear the active marker and release the workspace without deleting the recent entry; verify a test asserts the record survives disconnect and a reload does not auto-restore it
- [x] 2.5 Verify the token remains absent from the snapshot, plugin host state, plugin config state and recent summaries; run the security assertions in the remote runtime suite

## 3. Connect dialog and settings

- [x] 3.1 Add the recent-workspaces list to `ConnectRemoteDialog` with Open and Remove actions, prefill behavior, error handling and a list refresh after removal; verify component tests cover listing, opening, removing and a failed open
- [x] 3.2 Remove the `remember` checkbox and make the dialog state that connections and tokens are kept in this browser and removable; verify the rendered dialog contains no token and no `remember` input
- [x] 3.3 Add a "Remove from Recent Workspaces" action to `WorkspaceSettings` and wire it through `SettingsDialog` and `App`, guarded by the existing dirty-document check; verify a settings test removes the active entry and returns to no workspace
- [x] 3.4 Verify a connection-string connection still stores only decomposed fields and that the recents DOM, snapshot and stored record contain no `sfconn_v1_` value; run the App remote and connection-string tests

## 4. Contracts and roadmap

- [x] 4.1 Update the Stratofold section of `docs/contracts/workspace-api.md` for automatic persistence, the keyed/capped list, disconnect-versus-remove semantics and the metadata-only snapshot; verify every sentence maps to a delta requirement
- [x] 4.2 Update `docs/providers/stratofold.md` storage, multiple-workspace, residual-risk and verification sections for the recent list; verify no obsolete "session-only by default" or "single remembered connection" claim remains
- [x] 4.3 Add provider-track item P3 to `ROADMAP.md` with its outcome, dependencies, deliverables and exit criteria; verify `openspec validate --all` passes

## 5. Integration and deployment

- [x] 5.1 Run the full local gate (`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, bundle budget, dist CSP and dist elements) and confirm every command passes
- [x] 5.2 Measure the bundle; confirm the existing limits pass or raise `apps/shell/budget.json` with the measured number and recorded headroom
- [ ] 5.3 Against `https://mode777.github.io/exo-editor/`, connect two different Stratofold workspaces, confirm both appear newest-first, reopen each from the list, remove one and confirm its token and entry are gone, and confirm disconnect keeps the entry
- [ ] 5.4 Against the deployed shell, reload with an active recent entry and confirm it restores; revoke a stored token and confirm the reconnect state names it without mounting or deleting it; confirm no token appears in the DOM, network URLs or `localStorage`

## Workflow follow-up

- Archive the change after the deployed evidence and review requirements are satisfied.
- Sync the `remote-workspace` and `workspace-access` deltas into `openspec/specs/` and confirm `openspec validate --all` passes afterwards.
