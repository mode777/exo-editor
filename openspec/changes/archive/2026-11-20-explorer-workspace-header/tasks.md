# Tasks

## 1. Explorer workspace header

- [x] 1.1 Render a header row above the tree with the header twisty, the active descriptor's display name (`snapshot.descriptor.name`, truncated with the full name in `title`) and the action group; remove the text toolbar. Verify in `App.workspace.test.tsx` that the ready explorer shows the workspace name and no "New File"/"New Folder"/"Refresh" text buttons.
- [x] 1.2 Add the four `IconButton` actions (`new-file`, `new-folder`, `refresh`, `collapse-all`) with the labels "New File", "New Folder", "Refresh Explorer" and "Collapse Folders in Explorer"; disable New File and New Folder when `!writable`, disable Collapse Folders when the expanded set is empty, and keep Refresh enabled while ready. Verify in `App.workspace.test.tsx` that the read-only case renders disabled mutation buttons and that each action still performs its operation in a writable workspace.
- [x] 1.3 Add the local root-expansion state: the header twisty reports `aria-expanded`, hides the rows when collapsed and restores them without re-listing or clearing the expanded set. Verify with a test that expands a nested directory, collapses and re-expands the root, and still sees the nested child.
- [x] 1.4 Style the header and its icon buttons in `apps/shell/src/app.css` using the existing `--vscode-*` tokens: name row, truncation, disabled opacity without hover, and focus-visible ring. Verify with `npm run format:check`, `npm run lint` and the explorer axe scan.

## 2. Collapse Folders in Explorer

- [x] 2.1 Add `collapse-all` to `apps/shell/src/explorer/bus.ts`, handle it in `ExplorerView` by clearing the expanded set, and verify with a test that starts from two expanded directories, invokes the action from the header and sees only the root's direct children.
- [x] 2.2 Add `exo.explorer.collapseAll` to `apps/shell/src/workbench/commands.ts` (category Explorer, available when a workspace is ready), a `collapseExplorer` handler wired through `requestExplorerCommand('collapse-all')` in `App.tsx`, and a View menu entry. Verify with `workbench/commands.test.ts` availability cases, `workbench/menus.test.ts`, and a palette-path test that collapses the tree.

## 3. Single-click directory expansion

- [x] 3.1 Toggle a directory on a single row click while keeping selection, and keep the file row's open gesture on double-click and Enter. Skip the toggle while that row's inline rename input is active. Verify with updated `App.workspace.test.tsx` and `explorer/explorer.perf.test.tsx` cases that expand a directory with one `click` and still open a file only after its open gesture.
- [x] 3.2 Confirm the keyboard contract is unchanged: Arrow Right/Left, Enter, Home/End, F2 and Delete still move, toggle, rename and delete with focus kept on a valid row. Verify with the existing `App.workspace.test.tsx` keyboard cases and the `a11y.test.tsx` tree semantics case.

## 4. Accessibility and documentation

- [x] 4.1 Extend `apps/shell/src/a11y.test.tsx` to cover the header controls (named buttons, disabled states, the twisty's `aria-expanded`) and the single-click directory expansion, and verify the axe scan reports no violations for `.exo-explorer`.
- [x] 4.2 Update `docs/accessibility.md`: the scope line names the workspace header instead of the toolbar, the manual script describes single-click expansion and the four header actions, and the read-only step checks the disabled icons. Verify with the guide/heading link checks in `npm test`.
- [x] 4.3 Record the shell-visible addition in the existing `0.1.0` post-release entry in `CHANGELOG.md`. Verify with `npm test --workspace @exo/shell -- --run src/quality/changelog.test.ts`.

## 5. Verification

- [x] 5.1 Run the full local gate from `AGENTS.md` (`lint`, `format:check`, `typecheck`, `test`, `build`, the dist checks, template and code-plugin builds and `check:dist-secrets`) and confirm it passes.
- [x] 5.2 Deploy by pushing `main` and verify against `https://mode777.github.io/exo-editor/` with the demo workspace: the explorer header shows the workspace name and four icons, icon actions work, a directory expands on one click, Collapse Folders closes every folder, and a read-only workspace shows disabled New File/New Folder. Record the deployed result in `design.md` and leave this task open if it cannot be verified there.

## Workflow follow-up

- Archive `explorer-workspace-header` after the deployed verification passes.
- Update the post-layer note in `AGENTS.md` when the change is archived.
