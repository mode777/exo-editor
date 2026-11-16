# Design

## Context

See `proposal.md` for motivation and the `editor-shell` delta for normative
behavior. The relevant current state:

- `apps/shell/src/workbench/commands.ts` already defines
  `exo.workspace.connectRemote` with category `File` and wires it to
  `handlers.connectRemote`.
- `apps/shell/src/App.tsx` routes that handler through
  `requestRemoteConnect()`; the connect-bus listener wraps the dialog in
  `guardDirty`, so unsaved work is prompted before the dialog opens.
- `apps/shell/src/workbench/menus.ts` defines the File menu but has no connect
  entry.
- The workbench kit's `MenuBar` renders every declared entry and reports the
  chosen `commandId`; it has no registry and no availability filtering. The
  shell's `CommandRegistry.run` re-checks availability, so a menu entry for an
  always-available command is a real action, not a decorative no-op.

## Goals / Non-Goals

**Goals:**

- Make the existing connect command discoverable from the File menu without a
  second handler, dialog or state machine.
- Pin the entry with a regression test so it cannot silently disappear.

**Non-Goals:**

- A menu-level availability or permission model, submenus, icons, shortcuts or
  a configurable menu layout.
- Changing which workspace actions appear where beyond the one connect entry.

## Decisions

### D1 - Add one entry to the existing File menu definition

Add `{ label: 'Connect Remote Workspace…', commandId: 'exo.workspace.connectRemote' }`
to the File menu directly after `Open Folder…`, before the separator that starts
the create actions. This groups the two workspace-opening paths, matches the
label already used in settings and the palette, and keeps create/save/open-with
grouping intact.

Alternatives: put it in a new Workspace menu (adds a top-level menu for one
action); put it after New Folder (separates it from Open Folder); rely on the
palette only (current discoverability gap).

### D2 - Reuse the command and its handler; add no menu-specific path

The menu entry stores only the command id. Choosing it goes through the same
`CommandRegistry.run` used by the palette, so the existing availability check,
connect-bus, dirty guard, dialog and connection state are the only ones in play.
The entry declares no keybinding and no separate `onClick`.

Alternatives: a direct menu callback (duplicates the registry path and could
diverge from the palette); a new command id for the menu (two ids for one
behavior).

### D3 - Keep the entry unconditionally listed

The shell's menu definitions are static and the kit does not filter entries. That
is acceptable here because `exo.workspace.connectRemote` has no availability
rule: connecting a remote workspace is valid with no workspace, with a local
folder or with an existing remote connection, and the dirty guard runs when a
workspace is active. The entry therefore never presents a dead action. Commands
with real preconditions (Save, New File, Disconnect, Restore Access) stay out of
the menu or keep their palette filtering.

Alternatives: teach the shell to filter menu entries by context (a new menu
contract for one entry); add a disabled state (the kit has no disabled item
shape); make the entry conditional and risk the same hidden-again problem.

### D4 - Test the definition and the actual wiring

Two layers of regression:

1. A menu-definition test in `apps/shell/src/workbench/menus.test.ts` asserts the
   File menu contains the connect entry in the intended position and that every
   menu `commandId` resolves to a command created by `createExoCommands`. The
   latter fails on a typo or a removed command, not just the connect label.
2. An App-level test in `apps/shell/src/App.remote.test.tsx` opens the File menu,
   selects the connect item through the context-menu element's selection event,
   and asserts the existing `#exo-connect-server` dialog appears. This proves the
   menu path reaches the same handler and is not just a matching string.

The App test dispatches `vsc-context-menu-select` with
`detail.value = 'exo.workspace.connectRemote'`, matching how the kit's
`ContextMenu` reports selection; no new production seam is needed.

## Risks / Trade-offs

- **The menu still shows the entry when connecting is not useful** → it is
  always useful: it can replace the current workspace or reconnect; no state makes
  the action invalid, and the dirty guard protects unsaved work.
- **Label drift between menu, palette and settings** → the menu test pins the
  label and the command id; all three point at the same command.
- **A future menu refactor drops the entry** → the definition test fails.
- **A future command rename breaks the menu** → the all-command-ids test fails.
- **Duplicate activation** → the App test asserts one dialog instance; the entry
  has no local state to duplicate.

## Migration Plan

- Deploy through the normal `main` push: CI verifies, then Pages publishes.
- No stored data, workspace file, manifest, consent record or protocol version is
  migrated. Rollback removes the one menu entry and its tests; the command,
  dialog and connection behavior are untouched.

## Open Questions

None. Placement, reuse, unconditional listing and the test strategy are decided
above and reflected in the spec and tasks.
