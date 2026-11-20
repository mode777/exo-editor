# Design

## Context

See `proposal.md` - Why. Current state that shapes the approach:

- `apps/shell/src/explorer/ExplorerView.tsx` owns the tree, its toolbar, dialogs
  and context menu. The workbench view registry (`workbench/views.tsx`) supplies
  only the view title ("Explorer"), which the kit renders as the side-bar header.
- The kit's `ViewDefinition.actions` (in `vscode-workbench` 0.1.3) renders icon
  buttons but exposes no disabled state; the exposed `IconButton` primitive in
  `vscode-workbench/react` forwards native button props, including `disabled`.
- The status bar already renders `<descriptor.name> · <providerKind>`. The
  explorer reads the same `snapshot` and `session` and needs no new state source.
- The reference editor's row in the user's screenshot is the explorer's root
  node (workspace folder row), not the kit's uppercase view title.

## Goals / Non-Goals

**Goals:**

- Match the reference editor's explorer root row: workspace name plus the four
  applicable actions, with the same names Exo already uses.
- Keep the read-only guarantee that mutation controls are disabled, not merely
  inert.
- Make directory expansion a single click without changing keyboard behavior or
  making a browse click open tabs.

**Non-Goals:**

- Changing the kit's side-bar header, its view title, or any vendored style.
- A workspace switcher, search/explore tabs, multi-select, drag and drop, or
  persisted expansion state.
- Preview tabs or single-click file opening.

## Decisions

### Workspace header lives in the Exo-owned explorer view

Render the header above the tree inside `ExplorerView`, not through the view
registry title or the kit's `ViewAction` list. The kit's action list cannot
express a disabled state, and the requested row is the tree's root node. A
Kit-level title would also have to become dynamic, coupling the static view
registry to workspace state.

Alternatives rejected: dynamic view title plus `actions` (enabled no-ops in a
read-only workspace, no collapse action, wrong visual role); a fully custom
header that replaces the kit's side-bar header (loses the kit's header and close
control and needs CSS overrides of vendor chrome).

### Actions use the public icon-button primitive

The header's actions are `IconButton` from `vscode-workbench/react` with
`variant="toolbar"` and codicon names `new-file`, `new-folder`, `refresh` and
`collapse-all`, labelled "New File", "New Folder", "Refresh Explorer" and
"Collapse Folders in Explorer". The primitive forwards `disabled`, so a
read-only session renders genuinely disabled buttons. The action group is a
plain `div`: no `role="toolbar"` is claimed, because that role promises
arrow-key navigation this surface does not implement.

New File and New Folder are disabled when `!writable`. Refresh stays enabled
while the workspace is ready. Collapse Folders is disabled when the expanded set
is empty. Every control has an accessible name and a tooltip from its label.

### Root expansion is local and non-destructive

The header's twisty toggles a local `rootExpanded` flag (default expanded) that
controls whether the tree rows are rendered. Collapsing the root hides rows but
keeps the cached children and the expanded set, so re-expanding does not re-list
and does not forget which directories were open. The flag resets with the
existing per-generation remount, so a workspace switch starts expanded again.

Collapse Folders in Explorer clears the expanded set and leaves the root
expanded, matching the reference editor: it closes every folder, not the
workspace.

### Single click toggles directories; files still open deliberately

The row click handler selects the row and, for a directory, toggles expansion.
A file row still only selects; `onDoubleClick` remains attached for files and
Enter still opens. This keeps a browsing click from opening a tab and keeps the
existing selection-driven create/rename/delete targeting.

The click handler returns early while that row's inline rename input is active,
so clicking the rename field cannot collapse the row that hosts it. A real
double-click on a directory fires two clicks and therefore toggles twice, which
is the reference editor's behavior and needs no special case.

### Collapse Folders is a command and a local action

Add `exo.explorer.collapseAll` to the command registry (category Explorer,
available whenever a workspace is ready) and to the View menu. Both the command
and the header button reach the view through the existing explorer bus as
`collapse-all`, next to `new-file`, `new-folder`, `rename` and `delete`. The
header buttons keep calling the view's local handlers, as the removed toolbar
did; the command palette path keeps using the registry. The action is an
idempotent no-op when nothing is expanded.

### Naming and styling follow the existing tokens

The header reads `snapshot.descriptor.name`, truncates with an ellipsis and
keeps the full name in `title`. It uses the same `--vscode-*` tokens as the
tree, without the kit header's uppercase transform, so it reads as the tree's
root row rather than a second view title. Disabled icon buttons keep their
location, drop to reduced opacity and lose the hover background.

## Risks / Trade-offs

- [Header duplicates the status-bar workspace name] -> Both read the same
  descriptor; the explorer becomes self-describing and the status bar keeps its
  provider suffix. No second source of truth.
- [A browser fires two clicks on a directory double-click] -> Same as the
  reference editor: expand then collapse. Keyboard users keep Enter/Arrow keys.
- [Icon-only actions are ambiguous] -> Accessible names, tooltips, and the
  palette/menu entries keep the text labels available.
- [Single click on a file could be mistaken for the open gesture] -> The row
  still opens on double-click and Enter; selection and focus are unchanged.
- [Kit styling changes in a future minor] -> The action button uses the public
  primitive and class only; the composition guard keeps imports on public entry
  points, and the pinned minor makes visual drift a reviewed upgrade.
- [Perf budget regression] -> The header adds constant markup, no listing and no
  stat; the 10k-entry test still counts exactly the tree rows.

## Migration Plan

No data migration and no contract change. Deploy is the normal push to `main`;
rollback is reverting the change. Existing workspaces, persisted handles, remote
connections and plugin state are untouched.

## Deployed verification

Verified on 2026-11-18 against `https://mode777.github.io/exo-editor/` at commit
`cb1b731` (deployed asset `assets/index-DOxJJNXg.js`) with
`chrome-headless-shell` 131.0.6778.264 at 1280x800. The workspace was an OPFS
directory named `demo-workspace` returned by a `showDirectoryPicker` stub,
matching the capture method used by `docs/walkthrough.md`.

- The header shows `demo-workspace` with the twisty and the four actions in
  order, New File/New Folder/Refresh enabled, and Collapse Folders disabled with
  nothing expanded.
- One click on a directory shows its children; Collapse Folders removes them,
  keeps the root's direct children, and disables itself; the twisty hides and
  restores the tree.
- One click on a file does not open an editor; a double-click opens it.
- After a reload with write permission reported as `prompt`, the workspace
  restores read-only, the banner appears, New File and New Folder are disabled
  and Refresh stays enabled.
- No page errors were logged.

