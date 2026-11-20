# Tasks

Prerequisite: land `plugin-view-surfaces` first. It supplies the view pool, view sessions and `ViewClient` that panel and content-view command targets use.

## 1. Manifest, schema and consent

- [x] 1.1 Add `contributes.commands` to `schema/exo.schema.json` and `apps/shell/src/plugins/manifest.ts` with id, title, category, target and menus; verify valid editor, panel and content-view commands and the 32-command, id, title and category limits in `manifest.test.ts`.
- [x] 1.2 Validate target references against `contributes.panels` and `contributes.contentViews`, unknown target kinds, duplicate ids, the `editor/title` with `activeEditor` rule and the `explorer/context` with a view-target rule; verify each rejection names the command and field.
- [x] 1.3 Add the first-grant consent section listing each command's title, target and placements, and verify that adding, removing or changing a command leaves `computeFingerprint` output and an existing consent record unchanged.

## 2. Registration, registry and host

- [x] 2.1 Parse `plugin/register.commands`, preserve arrival order and deduplicate ids; verify subset, duplicate, unknown-field and non-array cases in `registration.test.ts`.
- [x] 2.2 Extend `shell/register-ack` with `acceptedCommands` and an optional rejection `kind`; verify an older-shaped ack still parses and a mixed accepted/rejected registration reports both.
- [x] 2.3 Reject `target-not-registered` at `plugin/register-complete` when a panel or content-view target was not registered in the same session; verify the panel-first, command-first and missing-target orders.
- [x] 2.4 Add a `CommandRegistry` keyed by plugin identity and registration order, expose active commands in the host snapshot and remove them on stop; verify completion gating, ordering and removal in `host.test.ts` and registry tests.
- [x] 2.5 Reset commands, cooldowns, pending invocations and notices on a workspace switch and ignore late results from a released frame; verify the switch and late-callback tests fail when the reset is removed.
- [x] 2.6 Extend the settings status and plugin log with registered command titles, targets, invocations and outcomes; verify the status, log-cap and workspace-reset tests.

## 3. Protocol and invocation controller

- [x] 3.1 Add `shell/command`, `plugin/command-result`, the invocation id, the args shape and `capabilities.commands` to the shell protocol types; verify phase violations, wrong-origin and wrong-frame drops, and absent-as-false parsing.
- [x] 3.2 Implement `PluginCommandController` resolution for the active editor handler, panel reveal and content-view open with the `command/<commandId>` instance key; verify each target, the inactive-editor no-op and parser-reject cases.
- [x] 3.3 Implement the ten-second result timeout, one-in-flight per command, five per plugin and five-second cooldown; verify success, failure, timeout, late result, frame disposal and `rate-limited` outcomes.
- [x] 3.4 Add command delivery to the handler and view sessions and require exactly one `plugin/command-result` per invocation; verify duplicate results are ignored and a result in the registration phase is a protocol violation.
- [x] 3.5 Add a command log entry for invocation, result, timeout and stale invocation without file content; verify the log shape and the mutation test for the stale-entry check.

## 4. Shell surfaces

- [x] 4.1 Extend `createExoCommandRegistry` with the live command provider, synthetic palette ids and plugin-attributed categories; verify list, run, stale invocation and shell-command non-shadowing tests.
- [x] 4.2 Add active explorer commands to `ExplorerView` after a separator, capped at ten and labelled with the plugin name; verify file and directory args, keyboard invocation, Escape and the cap.
- [x] 4.3 Render `editor/title` commands for the matching active editor in a shell-owned `role="toolbar"` row in `DocumentArea`; verify another plugin's action is hidden and the accessible name includes the plugin.
- [x] 4.4 Add the shell-owned notice region for failure and timeout with `role="status"`, bounded text, auto-dismiss and a dismiss button; verify success is silent and the notice is workspace-scoped.
- [ ] 4.5 Add the command-surface CSS and verify axe scans, focus order, 200% zoom and the palette, menu and toolbar keyboard paths.

## 5. SDK

- [x] 5.1 Add `RegistrationClient.registerCommand(id)` and `acceptedCommands` parsing, including an older ack without the field; verify register, subset, rejection-kind and older-shell tests.
- [x] 5.2 Add a shared command client with `onCommand`, the ten-message pre-handler queue, automatic success and failure results and the 200-character bound; verify editor and view client tests.
- [x] 5.3 Parse `capabilities.commands` absent-as-false on both clients and expose the support bit in the init types; verify an older-init fixture and the no-message behavior when unsupported.
- [x] 5.4 Bump `SDK_VERSION` and the package to `1.6.0`, update the compatibility notes and verify typecheck, unit tests, conformance and the no-SDK shell guard.

## 6. Contracts, security and documentation

- [x] 6.1 Update `docs/contracts/plugin-manifest.md`, `docs/contracts/plugin-protocol.md` and `docs/contracts/plugin-sdk.md` with the command shape, targets, menus, registration, messages, limits, support bit and versioning.
- [x] 6.2 Update the author guide with a command example, target selection, when to use a panel rather than a long-running result, and the `engines.exo` range needed for an older shell.
- [x] 6.3 Update `docs/security-review.md` with the command surface, attribution, non-fingerprint decision, args rule and stale-entry control; verify each new control has a test that fails when removed.
- [ ] 6.4 Update `docs/accessibility.md`, `docs/performance.md` and `docs/walkthrough.md` with the palette, menu and toolbar script, the first-command panel-mount measurement and the deployed acceptance path.
- [x] 6.5 Add the `CHANGELOG.md` entry naming shell `0.4.0`, protocol `1`, schema `1` and SDK `1.6.0`, the `ROADMAP.md` follow-up and verify the changelog test.

## 7. Fixture and deployed verification

- [x] 7.1 Add fixture commands for an active-editor action, a panel action with explorer args, a content-view action and a failing command; verify the fixture unit test and the host fixture README steps.
- [ ] 7.2 Verify palette attribution, the matching and non-matching editor action row, explorer file and directory args, lazy panel mount, content-view tab reuse, failure and timeout notices, stale entries and plugin disable on the deployed URL; record the commit and date.
- [x] 7.3 Run the full local gate from `AGENTS.md`, including lint, format, typecheck, unit tests, build, bundle budget, CSP, custom elements, no-SDK, no-Monaco and secrets checks, plus `openspec validate --all`.

## Workflow follow-up

- Land and archive `plugin-view-surfaces` before this change.
- If this change lands before `plugin-file-creation`, renumber both changes coherently so shell and SDK minors have no release gap.
- Archive this change after review, sync the deltas and verify the archived result.
