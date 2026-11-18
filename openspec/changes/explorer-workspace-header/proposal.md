# Proposal

## Why

The explorer does not say which folder is open. Its primary actions are three
text buttons ("New File", "New Folder", "Refresh") stacked above the tree, so the
surface spends vertical space on labels and still hides the workspace identity -
the status bar is the only place that names it. In a shell that can switch
between a local folder and a remote workspace, the explorer should be
self-describing, like the reference editor's explorer root row.

Directory rows also open only on double-click (or Enter), while the reference
editor expands them on a single click. The extra gesture is the difference
between browsing and operating a tree.

## What Changes

- Add a workspace header row above the tree: a twisty that shows or hides the
  tree, the active workspace's display name, and icon actions for New File, New
  Folder, Refresh and Collapse Folders in Explorer. This replaces the text
  toolbar; the same actions keep their accessible names.
- New File and New Folder are disabled when the session is not writable. Refresh
  stays available while the workspace is ready and Collapse Folders is disabled
  when no directory is expanded, so no icon is an enabled no-op.
- A single click on a directory row selects it and toggles its expansion. A
  single click on a file row still only selects it; double-click or Enter opens
  it. The inline rename input does not toggle its parent row.
- Add `exo.explorer.collapseAll` ("Collapse Folders in Explorer") to the command
  registry, the View menu and the explorer command bus.
- Keep the workspace name sourced from the active descriptor, so it follows a
  workspace switch and a remote connection without new state.

**Not breaking:** no workspace contract, plugin protocol, manifest, permission,
SDK or consent change. The explorer reads the same session and descriptor it
already reads. Keyboard operation (arrows, Enter, F2, Delete, Home/End) is
unchanged; single click is an additional pointer affordance, not a replacement.

**Explicit non-goals:** making a single click on a file open a tab, preview tabs,
multi-select, drag and drop, an explore/search split, a workspace switcher in the
header, reordering or hiding actions, and any change to the reused workbench
chrome or its view title.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `editor-shell`: the explorer gains a workspace header with the active
  workspace's name and icon actions, and a directory row toggles on a single
  click.

## Impact

- `apps/shell/src/explorer/ExplorerView.tsx`: header row, root expansion state,
  icon actions, single-click toggle and collapse-all handling.
- `apps/shell/src/explorer/bus.ts`: the `collapse-all` explorer command.
- `apps/shell/src/workbench/commands.ts`, `menus.ts` and the shell composition:
  the `exo.explorer.collapseAll` command and its handler.
- `apps/shell/src/app.css`: header and icon-action styles.
- Tests: `App.workspace.test.tsx`, `a11y.test.tsx` and
  `explorer/explorer.perf.test.tsx` move directory expansion to a single click
  and cover the header actions; `workbench/commands.test.ts` covers the new
  command.
- `docs/accessibility.md`: scope and manual script mention the header controls
  and single-click expansion.
