# Proposal

## Why

A plugin can contribute file editors and, with the open `plugin-view-surfaces` change, panels and content views, but it cannot expose an action. Everything a user starts must be a shell command, so a formatter, generator or inspector has no discoverable entry point. The shell already owns the command palette, menus, the explorer context menu and the plugin frames; what is missing is a command contribution and a validated delivery path to a live plugin frame.

## What Changes

- Add `contributes.commands` entries with `id`, `title`, optional `category`, a `target` and optional `menus`. A target is `activeEditor`, `{ "kind": "panel", "id" }` or `{ "kind": "contentView", "id" }`. Limits: 32 commands per plugin, title and category 1-40 characters, ids matching the existing contribution id rules and unique within the plugin.
- Require every panel or content-view target to reference a contribution declared in the same manifest. Register a subset of command ids through an additive `plugin/register.commands` list; extend `shell/register-ack` with an additive `acceptedCommands` array and a rejection kind while preserving the existing `accepted` glob array.
- Deliver an invocation as `shell/command { id, args? }` to the target frame and require a correlated `plugin/command-result { ok } | { ok: false, message? }`. Args are shell-derived only: `{ path, kind }` for an explorer invocation and no args for a palette or editor-title invocation.
- Reveal and, if needed, lazily mount a panel or open a content-view tab before delivering the command. Deliver to the active document's handler only when that handler belongs to the same plugin identity; otherwise the command is not listed.
- Show registered commands in the command palette, commands that declare `explorer/context` in the explorer menu with the selected path, and commands that declare `editor/title` in a shell-owned document action row above the matching editor.
- Validate menu placement: `editor/title` requires `activeEditor`, and `explorer/context` requires a panel or content-view target. `commandPalette` is always present and is the default.
- Add the runtime rules: one in-flight invocation per command, five concurrent invocations per plugin, a five-second per-command cooldown, a ten-second result timeout, and a bounded plain-text failure message. A timeout is logged and shown as a non-blocking notice; the target frame is not disposed.
- Attribute every palette entry, context-menu entry and document action to the plugin by name. A plugin command never replaces or aliases a shell command id, and there is no API for one plugin to invoke another plugin's command.
- Display commands in the first-grant consent prompt without changing the consent fingerprint. Adding, removing or changing commands does not re-prompt; the target frame's existing permissions still govern what the command can do.
- Add SDK `registerCommand(id)`, `onCommand(handler)` on editor and view clients, a `capabilities.commands` support bit and SDK `1.6.0`; shell `0.4.0`.

**Prerequisite:** land `plugin-view-surfaces` first. A command may target a panel or content view, and the command controller uses the view pool's reveal, lazy-mount and open-tab paths. `plugin-file-creation` is independent; commands lands first at shell `0.4.0` and SDK `1.6.0`, and `plugin-file-creation` is renumbered to shell `0.5.0` and SDK `1.7.0` so the release sequence has no gap.

**Not breaking:** the manifest field, registration field, messages and SDK helpers are additive within protocol major `1`, the schema stays `1`, and a plugin without commands behaves exactly as before. Older shells omit `capabilities.commands` and a plugin must treat absence as false.

**Explicit non-goals:** cross-plugin command invocation, plugin-defined keybindings, a general `when`-clause expression language, command aliases for shell commands, editor-title contributions that do not target an active editor, background command frames, arbitrary command arguments supplied by a plugin, and user-editable command enablement.

## Capabilities

### New Capabilities

- `plugin-commands`: command declarations, target resolution, presentation in the palette, explorer context menu and document action row, invocation and result rules, limits, attribution and teardown.

### Modified Capabilities

- `plugin-manifest`: adds the `contributes.commands` shape, target and menu validation, limits, consent display and the deliberate fingerprint exclusion.
- `plugin-protocol`: extends `plugin/register` and the acknowledgement with commands, adds `shell/command` and `plugin/command-result`, the allowed phases, args and limits.
- `plugin-sdk`: adds the registration helper, `onCommand`, the support bit, absent-as-false parsing and the version bump.
- `editor-shell`: adds the palette, explorer context-menu and document action-row integration, stale-entry handling, failure notices and accessibility requirements.
- `plugin-host`: registers command contributions, exposes them in the snapshot and log, and removes them on plugin stop and workspace switch.

## Impact

- `schema/exo.schema.json`, `apps/shell/src/plugins/manifest.ts`, `registration.ts`, `host.ts`, `protocol.ts`.
- New `apps/shell/src/plugins/commands.ts` (registry and invocation controller); `apps/shell/src/plugins/views.ts` neighbours for panel reveal and content-view opening.
- `apps/shell/src/App.tsx`, `workbench/commands.ts`, `workbench/menus.ts`, `explorer/ExplorerView.tsx`, `document/DocumentArea.tsx`, `app.css`.
- `packages/plugin-sdk/src`: protocol, registration, editor, view, browser and version modules.
- The plugin-host fixture or the plugin template for a deployed command example; contracts, author guide, security review, accessibility, performance, walkthrough, changelog and roadmap follow-up.
- Tests: manifest validation and limits, registration subset and rejection, target-not-registered, palette and menu derivation, attribution, editor-title gating, explorer args, lazy panel mount, content-view tab reuse, result success and failure, timeout and late result, cooldown and concurrency, plugin removal and workspace switch, consent no-reprompt, axe and keyboard checks.
