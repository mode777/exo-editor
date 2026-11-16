# Proposal

## Why

The shell can open a remote workspace, but the action is only reachable from the
settings surface, the empty-explorer state and the command palette. A user who
already has a workspace open and reaches for the File menu — the natural place
for "Open Folder…" — sees no way to connect a remote workspace. The command
already exists; only the menu entry is missing.

## What Changes

- Add `Connect Remote Workspace…` to the File menu, directly after
  `Open Folder…`, pointing at the existing `exo.workspace.connectRemote`
  command.
- Keep the existing entry points unchanged: settings, empty explorer and the
  command palette continue to offer the same command, so there is one handler,
  one dialog and one dirty-document guard.
- Add a regression test that pins the File-menu entry and proves choosing it
  runs the existing command and opens the connect dialog.

**Explicit non-goals:** a new dialog, form, shortcut or availability rule; a
menu-level permission model; removing the settings or explorer entry points;
adding Disconnect, Restore Access or other workspace actions to the File menu;
any change to connection storage, the provider, the protocol or the consent
fingerprint.

## Capabilities

### New Capabilities

None. This is a presentation change to an existing command.

### Modified Capabilities

- `editor-shell`: adds a requirement that the File menu exposes the workspace
  entry points, so a remote workspace can be connected without going through
  settings or the palette.

## Impact

- `apps/shell/src/workbench/menus.ts`: one File-menu entry.
- `apps/shell/src/workbench/menus.test.ts` (new) and/or
  `apps/shell/src/App.remote.test.tsx`: pin the entry and its command wiring.
- No shell runtime, workspace provider, plugin, manifest, protocol, consent,
  CSP, bundle-budget, documentation or deployment change beyond the normal
  verified Pages deploy.
