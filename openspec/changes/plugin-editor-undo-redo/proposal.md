# Proposal

## Why

The shell has no standard Undo/Redo surface for plugin editors. A visible plugin
frame can bind its own keys, but the workbench menu and shortcuts cannot reach
inside it, and a hidden handler (the default) has no interactive surface at all.
Clicking a menu entry also moves focus out of a plugin iframe, so native plugin
key handling cannot cover the menu path.

## What Changes

- Add two id-less shell-to-plugin notifications, `shell/undo` and `shell/redo`,
  delivered only to the active, writable editor handler for the active document.
  They carry no content, version or reply. The plugin applies its own history and
  reports the resulting state through `plugin/dirty`.
- Add an Edit menu with Undo/Redo, the palette commands `exo.edit.undo` and
  `exo.edit.redo`, and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y routing for
  active plugin documents.
- Keep history and undo availability entirely plugin-owned. The shell adds no
  undo stack, no content snapshot and no `canUndo`/`canRedo` tab state; a tab
  keeps only its existing plugin-reported dirty state.
- Keep the shell text surface on its native textarea undo. The new commands do
  not apply to text documents, and the keyboard path does not steal undo from
  shell inputs or the text editor.
- Add `onUndoRequest` and `onRedoRequest` to the SDK editor client, wire the
  Monaco reference plugin through its own history, and add a hidden fixture
  handler that proves the menu/shortcut path reaches a frame with no focus.
- No new permission, consent fingerprint input, manifest field or sandbox
  change. Protocol stays `1`, manifest schema stays `1`, SDK becomes `1.11.0`
  and the shell becomes `0.13.0`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-protocol`: adds id-less `shell/undo` and `shell/redo` notifications,
  their phase and eligibility rules, and the no-content, no-reply behavior.
- `editor-shell`: adds the Edit menu, palette commands and keyboard shortcuts,
  the active-plugin-document gate, the rule that only the active writable
  handler is targeted, and the exclusion of the shell text surface and shell
  inputs. History and dirty state stay plugin-owned; the shell holds no
  undo-availability state.
- `plugin-sdk`: adds the editor-client listeners for shell undo and redo and
  records the additive minor.
- `reference-code-plugin`: wires the Monaco reference editor to the shell
  intents through its own history.

## Impact

- `docs/contracts/plugin-protocol.md`, `docs/contracts/plugin-sdk.md`,
  `docs/guide/protocol.md`, `docs/guide/sdk.md`, `docs/guide/testing.md`,
  `CHANGELOG.md`, `docs/releases.md`, `README.md`, `AGENTS.md` and `ROADMAP.md`.
- `apps/shell/src/plugins/handler.ts`, `handlers.ts`,
  `apps/shell/src/workspace/runtime.ts`, `apps/shell/src/workbench/commands.ts`,
  `menus.ts`, `apps/shell/src/App.tsx` and their tests.
- `packages/plugin-sdk/src/editor.ts` and its tests;
  `apps/code-plugin/src/editor.ts` and its tests.
- `apps/shell/public/plugin-host-fixture/` manifest, handler script and a new
  hidden history page.
- No dependency, backend, permission, consent fingerprint input, workspace
  storage or manifest schema change.
