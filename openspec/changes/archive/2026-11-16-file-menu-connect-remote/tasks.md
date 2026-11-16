# Tasks

## 1. File-menu entry and definition test

- [x] 1.1 Add `Connect Remote Workspace…` to the File menu in `apps/shell/src/workbench/menus.ts`, directly after `Open Folder…` and before the create-action separator, with `commandId: 'exo.workspace.connectRemote'` and no separate handler or keybinding; verify the file compiles and the menu definition keeps the existing create, save and open-with grouping
- [x] 1.2 Add `apps/shell/src/workbench/menus.test.ts` pinning the File-menu entry label and position, and asserting every `commandId` referenced by any menu resolves to a command returned by `createExoCommands`; verify the test fails when the new entry is removed and when a command id is misspelled

## 2. Integration and deployed verification

- [x] 2.1 Add an App-level test in `apps/shell/src/App.remote.test.tsx` that mounts the shell, opens the File menu, selects `Connect Remote Workspace…` through the context menu's selection event, and asserts the existing remote-connect dialog appears; verify the test fails when the entry is removed and the dialog is not mounted twice
- [x] 2.2 Run the full local gate from `AGENTS.md` (`npm ci`, lint, format check, typecheck, tests, shell build, budget, CSP, custom elements, no-SDK, no-Monaco, template build/copy, code-plugin build/copy, secrets check) plus `openspec validate --all`; verify every command passes
- [x] 2.3 Push `main`, confirm the CI `verify` and Pages deploy jobs pass, and confirm the deployed artifact is the commit under test
- [x] 2.4 Against the deployed shell, open the File menu with no workspace and again with a folder workspace, choose `Connect Remote Workspace…` from the menu in both states, and confirm the same connect dialog opens; with a dirty document open, confirm the dirty prompt resolves before the dialog and that Cancel leaves the document unchanged and the dialog closed
- [x] 2.5 Record the post-layer follow-up in `ROADMAP.md` with the change name, the File-menu entry and the deployed evidence; verify the note matches the deployed behavior and the archived change name

## Workflow follow-up

- Archive the change after the deployed evidence and the project's review requirements are satisfied.
- Sync the `editor-shell` delta into `openspec/specs/` and re-run `openspec validate --all`.
