# Tasks

## 1. Contracts and author documentation

- [x] 1.1 Add the `shell/undo` and `shell/redo` block and rules to `docs/contracts/plugin-protocol.md` section 5.3: editor phase only, active writable handler, clean-document eligibility, no id/content/reply, plugin-owned history and the silent no-op for empty history; verify the contract matches the `plugin-protocol` delta and `openspec validate --all` passes.
- [x] 1.2 Document `onUndoRequest` and `onRedoRequest` in `docs/contracts/plugin-sdk.md`, `docs/guide/sdk.md` and `packages/plugin-sdk/README.md`, add the intent to `docs/guide/protocol.md`, and add the deployed manual check to `docs/guide/testing.md`; verify every message name links to the owning contract and no limit is restated.
- [x] 1.3 Cross-check the four delta specs against the contract text, run `openspec validate --all` and confirm every item passes, and run `openspec validate plugin-editor-undo-redo --strict` and confirm it has no warnings; the pre-existing long-requirement warnings in the main specs are out of scope.

## 2. Handler and runtime routing

- [x] 2.1 Add `requestUndo()` and `requestRedo()` to `HandlerSession` in `apps/shell/src/plugins/handler.ts`, posting one id-less message only when the session is active and writable; verify with handler tests for the active frame, a missing frame, a clean document, a read-only session and a disposed session.
- [x] 2.2 Add path-scoped `undo()` and `redo()` to `HandlerPool` in `apps/shell/src/plugins/handlers.ts`; verify a known path routes to its session and a missing or inactive record sends nothing.
- [x] 2.3 Add `undoActiveDocument()` and `redoActiveDocument()` to `apps/shell/src/workspace/runtime.ts`, requiring an active plugin surface, active handler phase, writable workspace, non-read-only document and `editor.canWrite`; verify runtime tests for each rejection, a clean document that still routes, tab switching, workspace switch, and a removal test that fails when the active/writable guard is deleted.
- [x] 2.4 Add a handler test that a plugin-sent `shell/undo` or `shell/redo` is rejected as an unknown or wrong-direction message and performs no state change; verify the existing plugin-message phase table and unknown-message behavior are unchanged.

## 3. Shell command surfaces

- [x] 3.1 Add `exo.edit.undo` and `exo.edit.redo` to `apps/shell/src/workbench/commands.ts` under the `Edit` category, extend `CommandContext` with an active writable plugin-document flag, and wire the handlers; verify command-registry tests for listing, availability and no-op behavior.
- [x] 3.2 Add the `Edit` menu with Undo and Redo to `apps/shell/src/workbench/menus.ts`; verify menu tests for the entries, order and shortcut labels, and that a menu invocation outside a plugin document is a no-op.
- [x] 3.3 Extend the `keydown` handling in `apps/shell/src/App.tsx` for Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y: skip editable targets, an open modal dialog, already-prevented events and non-plugin documents; verify tests for each shortcut, the text surface, a shell input, a modal dialog, a read-only document and an inactive tab.
- [x] 3.4 Add the new commands and menu entries to the shell accessibility test or manual script; verify keyboard reachability, accessible labels and Escape behavior with no regression in `npm test`.
- [x] 3.5 Bump the shell to `0.13.0` in `apps/shell/package.json`, `apps/shell/src/version.ts`, `package-lock.json` and the shell version row in `docs/releases.md`; verify the version-consistency test and that `SHELL_VERSION` is the only advertised value.

## 4. SDK

- [x] 4.1 Add `onUndoRequest()` and `onRedoRequest()` to `editor.ts` in `packages/plugin-sdk`, backed by `MessageGate` and returning unsubscribe functions; verify SDK tests for one listener call per message, multiple listeners, unsubscribe, no reply/content/dirty send, missing listener and disposal.
- [x] 4.2 Bump the SDK to `1.11.0` in `packages/plugin-sdk/package.json` and `packages/plugin-sdk/src/protocol.ts`, update the `SDK_VERSION` assertions, every workspace `@exo/plugin-sdk` reference and `package-lock.json`; verify `npm test`, `npm run typecheck` and `npm run check:dist-no-sdk` pass.
- [x] 4.3 Add the `1.11.0` entry to the additive-minor history in `docs/contracts/plugin-sdk.md` and `docs/releases.md`; verify the version axes table and the SDK contract list agree.

## 5. Reference plugin and fixture

- [x] 5.1 Wire the code plugin in `apps/code-plugin/src/editor.ts` to `onUndoRequest`/`onRedoRequest` through `editor.trigger('exo', 'undo' | 'redo', null)`; add a saved-text baseline updated on load, successful save and external reload, report dirty from the model comparison, retire `shouldClearDirty` if it becomes unused (moving its cases into the new tests), and verify plugin and dirty tests for undo, redo, return-to-clean and a failed save.
- [x] 5.2 Add a hidden `**/*.history.txt` fixture mode: a page, a manifest entry, the matching `plugin.html` registration, an initial local edit, in-memory undo/redo stacks, a saved-text comparison for dirty, and `#observation` records for each intent, buffer and dirty report; update `apps/shell/src/plugins/fixture.test.ts` for the new editor count, glob and entry, and verify the README table/manual check use the deployed path.
- [x] 5.3 Update `apps/code-plugin/README.md` and `apps/shell/public/plugin-host-fixture/README.md` with the in-frame shortcut, the shell menu/palette route and the hidden-handler check; verify the documented workspace file and deployed manifest URLs exist.

## 6. Release records

- [x] 6.1 Add the change to `CHANGELOG.md`, `README.md`, `AGENTS.md` and the `ROADMAP.md` post-layer-10 follow-up with shell `0.13.0`, SDK `1.11.0`, protocol `1` and manifest `1`; verify the version-consistency test, the version axes table and that no stale current-state summary remains.
- [x] 6.2 Verify `openspec validate --all`, `openspec validate plugin-editor-undo-redo --strict` and `npm test` after the release records; confirm the change artifacts and the synced docs use the same change name and versions.

## 7. Integration and deployment

- [x] 7.1 Run the full CI gate locally as a development aid: `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, the bundle budget, CSP/elements/no-sdk/no-monaco checks, template/code builds and copies, marketplace checks and the secrets check; resolve every failure before pushing.
- [x] 7.2 Push `main`, wait for the CI `verify` job and Pages deploy, then verify on `https://mode777.github.io/exo-editor/`: the code plugin's menu, palette and shortcut undo/redo with the saved-text dirty transition; the hidden fixture `.history.txt` handler with the same surfaces; the text surface's native undo and hidden palette entries; the read-only fixture's no-op; no console errors and the bundle budget.
- [x] 7.3 Record the deployed commit, date, fixture URL and observations in the design's Deployed Verification section; verify `openspec validate --all` passes.

## Workflow follow-up

- Archive `plugin-editor-undo-redo` after the deployed verification is recorded and reviewed, then sync the delta specs into the main specs.
