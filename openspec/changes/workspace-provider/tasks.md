# Tasks

## 1. Contract and documentation alignment

- [x] 1.1 Add `WorkspaceAccess`, `WorkspaceSession`, `WorkspaceHandle.requestPermission`, open-document refresh and external-change types to `docs/contracts/workspace-api.md`, including the shell/plugin caller distinction and the permission-state note; verify every statement has a matching requirement or scenario in the two delta specs and `openspec validate workspace-provider --strict` passes
- [x] 1.2 Update `docs/architecture.md` to state that the session, not individual views, owns normalization, containment, reserved paths, version checks and the focus refresh; confirm the wording matches `docs/contracts/workspace-api.md` and does not add a provider method the spec does not describe
- [x] 1.3 Record the unsupported-browser decision in `ROADMAP.md`'s layer 2 notes or `docs/architecture.md`: the memory provider is a test oracle, unsupported browsers get the explicit state, and no mock tree is mounted; verify the roadmap deliverable and the ratified requirement no longer contradict each other

## 2. Contract types, paths and session guards

- [x] 2.1 Add `src/workspace/contract.ts` with the provider, session, stat, change, capability and error types mirrored from the contract plus `WorkspaceError`; add a unit test that pins all eleven error codes and the `WorkspaceError` fields, and verify `npm test` fails if a code is removed
- [x] 2.2 Implement `src/workspace/paths.ts` for normalization, containment and reserved-path checks (backslash, `..`, `.`, `//`, trailing slash, NUL, control characters, 255-byte segments, 4096-byte total, case folding when the provider is case-insensitive); add table-driven tests including `EXO.JSON` on a case-insensitive provider and verify the tests fail when any rejection rule is deleted
- [x] 2.3 Implement the session shell methods and the `forPlugin(pluginId)` facade with reserved-path filtering, caller-attributed denial logging and mapped errors; add tests that shell access to `/exo.json` succeeds while plugin `read`, `stat`, `write`, `mkdir`, `remove`, `move` and root `list` deny or hide it, and verify the plugin test fails if the guard is removed
- [x] 2.4 Implement `ifVersion` comparison, `WorkspaceError` mapping and operation abort checks in the session; add tests for a stale write returning `conflict` without touching the provider, `not-found` on a missing path, and an already-aborted signal starting no provider call

## 3. Providers and persistence

- [x] 3.1 Implement `src/workspace/providers/memory.ts` with an injectable clock, per-file monotonic versions, synchronous watch delivery in operation order and the contract's capabilities; add tests that run the same operation sequence twice and observe identical paths, versions, mtimes and callback order
- [x] 3.2 Write `src/workspace/providers/conformance.ts` as a shared suite covering list, stat, read, write, mkdir, remove, move, already-exists, not-found, not-a-file, not-a-directory, conflict, abort, capability parity and dispose; run it against the memory provider and verify it passes before the folder provider exists
- [x] 3.3 Add `src/workspace/providers/folder/fsa.ts` with the local ambient declarations for `showDirectoryPicker`, `queryPermission`, `requestPermission`, async directory iteration and `move`, plus `DOMException`-to-`WorkspaceError` mapping; add unit tests for each exception name and verify unmapped errors become `io`
- [x] 3.4 Implement `FolderWorkspaceProvider` with injected picker, handle store and platform, including `open`, `restore`, capabilities, list/stat/read/write/mkdir/remove/move and the terminal `dispose`; back it with a fake `FileSystemDirectoryHandle` tree and run the conformance suite plus folder-specific tests for picker cancellation, permission denial, case sensitivity and version/conflict behavior
- [x] 3.5 Implement `IndexedDbHandleStore` (database `exo-workspace`, store `handles`, key `last`) and add `fake-indexeddb` as a dev dependency; test put/get/clear, missing record, a structured-cloned handle round-trip and that `localStorage` contains no handle, then verify `npm install`, `npm test` and `npm run typecheck` pass
- [x] 3.6 Implement permission restore and escalation: readwrite granted restores writable, read-only restores with `writable: false`, a denied request stays read-only, a provider without `requestPermission` returns `unsupported`, and a missing handle clears the record and yields no workspace; verify each state has a test and `npm test` passes

## 4. Session lifecycle and external refresh

- [x] 4.1 Implement session `dispose()` with generation capture, controller abort and listener/watch cleanup; add tests for a read and a save in flight during dispose (`aborted`, no state mutation), double dispose resolving without error, and a late provider callback being dropped
- [x] 4.2 Implement `setOpenDocuments`, `refreshOpenDocuments` and `onExternalChange`, installing `focus`/`visibilitychange` listeners on an injected target only when `watchable: false` and documents are tracked; test changed, deleted, unchanged, coalesced and post-dispose refresh cases
- [x] 4.3 Implement session `requestPermission()` and capability republishing; test that a grant flips `writable`, a denial leaves it false, and the capability snapshot updates without recreating the workspace

## 5. Preset store, tabs and controller

- [x] 5.1 Implement `configurePresetStore()` in `src/workbench/tabs.ts` with a `partialize` that persists theme, visibility, panel-maximized, sash sizes and active views but not tabs, closed tabs, quick open, output or notifications; add a reload test asserting layout survives while tabs do not, and verify `localStorage` never grows a tab array
- [x] 5.2 Implement the tab adapter: open a file tab keyed by path, activate, mirror dirty/clean, update path and title on rename, and clear tabs plus closed-tab history on workspace switch; add tests for each transition and for no old tab appearing after a switch
- [x] 5.3 Implement the close guard that wraps `closeTab`, `closeOtherTabs` and `closeAllTabs`, pausing on dirty targets until Save, Discard or Cancel resolves; add tests for each choice, for close-all with multiple dirty tabs, and a negative test that removing the guard closes a dirty tab silently
- [x] 5.4 Implement `WorkspaceRuntime` and the controller snapshot store (`starting`, `restoring`, `ready`, `unsupported`, `failed`, generation, descriptor, capabilities, error, restore availability); test start/restore, open, cancelled picker leaving the old workspace, switch ordering, permission escalation and a generation-keyed reset
- [x] 5.5 Register the `beforeunload` warning while any document is dirty and remove it when clean; add a test that the event is prevented only while dirty and verify the handler does not run after unmount

## 6. Explorer

- [x] 6.1 Build the lazy explorer tree with root loading, directory expansion, directory-before-file ordering, reserved-entry filtering, read-only disabling and explicit empty/unsupported states; add render tests for each state and verify no `exo.json`, `.exo` or fabricated entry is present
- [x] 6.2 Add create file, create folder, inline rename and confirmed delete using the session, with names validated by path normalization and failures shown inline on the entry; test success, `already-exists`, `permission-denied`, invalid names and focus re-anchoring after a removal
- [x] 6.3 Add keyboard operation with a roving tabindex: Up/Down, Right/Left, Enter, F2, Delete, Home/End, Escape and the context-menu key; add tests that drive the tree by keyboard and verify focus stays on a valid sibling or parent after rename/delete
- [x] 6.4 Add focus and visibility refresh for expanded directories, coalesced per directory, and per-directory error states with Retry while the rest of the tree stays usable; test an external file appearing, a failed directory and a successful retry
- [x] 6.5 Add explorer CSS for rows, indentation, focus, inline edit, banners and the empty/unsupported states; verify `npm run lint`, `npm run format:check` and the explorer render tests pass

## 7. Document surface

- [x] 7.1 Implement the document store and open pipeline: stat, 10 MiB limit, read, NUL sniff on the first 8 KiB, fatal UTF-8 decode and explicit loading/error/no-editor states; add tests for a 1 MiB file, binary, oversized, undecodable, `not-found` and `permission-denied`
- [x] 7.2 Implement the textarea surface with an uncontrolled buffer, dirty derivation from `text !== savedText`, dirty-dot sync and read-only rendering when the session is not writable; test typing, reverting, tab switching preserving the buffer and a 1 MiB document not re-rendering its value on each keystroke
- [x] 7.3 Implement save with `ifVersion`, exact `Uint8Array` output, version/baseline update and dirty clearing only when the text has not changed during the write; test round-trip bytes, edits during an in-flight save, `conflict` keeping disk content and dirty state, and a failed save keeping the tab open
- [x] 7.4 Connect the close prompt to the tab guard for Save/Discard/Cancel, reuse the save path, and keep the tab open when save fails; add tests for each choice and for a multi-tab close sequence
- [x] 7.5 Implement the external-change notice: clean documents offer Reload, dirty documents keep local edits with a conflict warning, deleted files show a deleted notice and no save action; test each case and a late refresh that must not touch the next workspace
- [x] 7.6 Handle rename and delete of the open document: rename moves the buffer, tab path/title and version, dirty content saves to the new path, delete aborts an in-flight save, drops the buffer and closes the tab, and a save cannot recreate the file; verify each case with tests
- [x] 7.7 Add document CSS for the editor, banners, dirty/conflict states and no-editor states; verify the document tests and `npm run build` pass

## 8. Commands, menus and status bar

- [x] 8.1 Replace the static command registry with a filtered registry: Open Folder always, Save/New File/New Folder/Refresh only when applicable, and `run()` re-checking the predicate; test palette contents with no workspace, with a workspace and with no active document, and verify Save is absent when no document is active
- [x] 8.2 Add File and View menu entries for Open Folder, New File, New Folder, Save and Refresh Explorer, and a `Ctrl/Cmd+S` key listener that saves the active text document; test the key path prevents the browser default and runs the same save handler
- [x] 8.3 Update the status bar to show the workspace name, provider kind and read-only state, with a Restore access action when permission is missing; add tests for no workspace, writable, read-only and permission-denied states
- [x] 8.4 Implement the unsupported-browser state and picker cancellation/failure handling, and add a guard test that the app source and production bundle do not import the memory provider; verify `npm run build` and the guard test pass and the memory provider is absent from `dist`

## 9. Integration and exit criteria

- [x] 9.1 Add an integration test that mounts the shell with the memory provider, opens a folder, expands, opens a file, edits, saves, renames the open file, deletes it, switches workspaces and asserts no tab, document, cache, close prompt or refresh callback from the old workspace remains; verify the stale-callback assertion fails if the generation check is removed
- [x] 9.2 Run the full repository gate from `AGENTS.md` (`npm run lint`, `format:check`, `typecheck`, `test`, `build`, budget, CSP, elements) and fix every failure; measure the new bundle and update `apps/shell/budget.json` deliberately with the measured headroom, recording the old and new sizes
  - Measured after implementation: JS 107,353 gzip (limit 115,000) and CSS 11,824 gzip (limit 14,000); both remain inside the committed budget, so no budget change was needed. 197 tests pass across 19 files.
- [x] 9.3 Run `openspec validate --all` and confirm both delta specs validate in strict mode and the contract documents mirror them
- [x] 9.4 Run the manual Chromium smoke pass against the deployed shell: open a folder, open a 1 MiB text file, edit and save, reload and restore access, deny write permission and confirm the read-only banner, rename and delete the open file, and check the unsupported state in Firefox or Safari; record the browser version and each result
  - Verified 2026-11-14 against `https://mode777.github.io/exo-editor/` with Chrome Headless Shell 131.0.6778.264 and Firefox 159 on the remote verification host. Headless Chrome cannot drive the native directory dialog, so the Chromium workspace was restored from a real `FileSystemDirectoryHandle` (OPFS) written into the shell's IndexedDB record. The deployed app passed: tree listing, text open, 1 MiB open, edit and Ctrl+S exact bytes, reload restore, open-file rename and save, open-file delete, denied-write read-only restore with the banner, explicit unsupported state, 1440x900 and 800x600 with no body scroll, and zero page or console errors. Real Firefox 159 showed the explicit unsupported state with no mock tree; Safari is unavailable on Linux. The native picker dialog itself is the only browser interaction that headless automation cannot drive.

## Workflow follow-up

- Archive the change with `openspec archive workspace-provider` once every task is checked and the exit criteria are demonstrated.
- Update `ROADMAP.md`'s layer 2 status and exit criteria, and `AGENTS.md`'s current-state paragraph, to say layer 2 is complete and layer 3 is next.
- Re-run `openspec validate --all` after archive and confirm `openspec/specs/workspace-access/spec.md` and `editor-shell/spec.md` contain the new requirements.
