# Tasks

Prerequisite: land `plugin-local-events` and `plugin-view-surfaces` first.

## 1. Workspace create-only path

- [x] 1.1 Add `createOnly?: boolean` to `WriteOptions` and implement `already-exists` behavior in the memory provider; verify new-file, existing-target, directory-target and normal-write tests.
- [x] 1.2 Implement create-only in the folder provider with a pre-check and document the residual check-to-write race in `docs/providers/`; verify the known-existing and parent-creation cases.
- [x] 1.3 Implement create-only in the Stratofold provider with a pre-check and document the residual check-to-write race in `docs/providers/stratofold.md`; verify the adapter tests and the fake server case.
- [x] 1.4 Extend the provider conformance suite with create-only cases for memory, folder and Stratofold; verify all three pass and existing content is preserved.
- [x] 1.5 Move the explorer's existing Empty File write to `createOnly` and verify the current name-dialog behavior against an existing name.

## 2. Manifest, schema and host registration

- [x] 2.1 Add `contributes.newFiles` to `schema/exo.schema.json` and `apps/shell/src/plugins/manifest.ts` with the id, label, name, encoding, content and size rules; verify text, base64, invalid, oversized, total-limit and reserved-name tests.
- [x] 2.2 Extend `plugin/register` with the `newFiles` id list and the additive ack; verify subset, undeclared, duplicate and missing-write-permission registrations.
- [x] 2.3 Extend the host snapshot, status and log with active templates and remove them on plugin stop and workspace switch; verify host tests.
- [x] 2.4 Add the first-grant consent section for templates without changing the fingerprint; verify the no-reprompt test and the existing fingerprint tests.

## 3. Protocol and frame path

- [x] 3.1 Add `plugin/request-new-file`, `shell/new-file-result`, the `already-exists` error code and the runtime limits; verify protocol unit tests.
- [x] 3.2 Implement the request validator: exactly one of `text`/`bytes`, optional name/directory hints, 8 MiB cap, `workspace:write`, active/visible/focused gate and ten-per-second budget; verify each rejection and the size message.
- [x] 3.3 Implement the correlated result and cancellation, the one-dialog rule and the disposal/workspace-switch close behavior; verify pending, cancel, late and disposal tests.
- [x] 3.4 Add `capabilities.createFile` to editor/view init and `capabilities.newFiles` to registration init; verify older-init parsing.
- [x] 3.5 Reject create requests from registration frames and disposed frames; verify no dialog opens and no write occurs.

## 4. Shell controller and dialogs

- [x] 4.1 Implement `NewFileController` with the pending request, target directory, name, content bytes, create-only write, cancellation and logging; verify unit tests.
- [x] 4.2 Add the Save As dialog with plugin name, directory navigation, editable name, size, bounded text preview and binary label; verify keyboard, focus trap, Escape and axe tests.
- [x] 4.3 Add the explorer New File template menu and the palette entries with Empty File preserved and read-only/removal behavior; verify menu, palette, read-only and plugin-removal tests.
- [x] 4.4 Wire template creation to pre-fill the name, write the decoded content, open the created file and report collisions without closing; verify template text and binary flows.
- [x] 4.5 Wire runtime creation to the same dialog, return `{ path, version }` or cancelled, and never auto-open; verify the result and no-tab cases.

## 5. SDK

- [x] 5.1 Add `registerNewFile(id)` and the additive ack handling; verify registration tests.
- [x] 5.2 Add `requestNewFile()` to `EditorClient` and `ViewClient` with support-bit, `workspace:write` and 8 MiB preflight; verify text, bytes, cancellation, collision, oversized and older-shell cases.
- [x] 5.3 Add `capabilities.createFile` and `capabilities.newFiles` parsing with absent-as-false; verify init and handshake tests.
- [x] 5.4 Bump `SDK_VERSION` and the package to `1.7.0`, update the compatibility notes and verify typecheck, unit tests and conformance.

## 6. Contracts, security and documentation

- [x] 6.1 Update `docs/contracts/workspace-api.md`, `docs/contracts/plugin-manifest.md`, `docs/contracts/plugin-protocol.md`, `docs/contracts/plugin-sdk.md` and the author guide with the create-only option, templates, runtime request, limits and support bits.
- [x] 6.2 Update `docs/security-review.md` with the create-only control, the folder residual race, reserved-name handling, dialog gating and the mutation tests.
- [x] 6.3 Update `docs/accessibility.md`, `docs/performance.md` and `docs/walkthrough.md` with the Save As dialog script, large-file behavior and the deployed generator acceptance path.
- [x] 6.4 Add the `ROADMAP.md` follow-up and the `CHANGELOG.md` entry naming shell `0.5.0`, protocol `1`, schema `1` and SDK `1.7.0`; verify the changelog test.

## 7. Fixture and deployed verification

- [x] 7.1 Add a text template and a binary template to the plugin fixture and a generator content view that calls `requestNewFile` with a small image; verify the fixture test.
- [ ] 7.2 Verify template creation, runtime creation, cancellation, an existing-name collision, a binary result and the 8 MiB rejection message on the deployed URL; record the commit and date.
- [x] 7.3 Run the full local gate from `AGENTS.md`, including lint, format, typecheck, unit tests, build, bundle budget, CSP, custom elements, no-SDK, no-Monaco and secrets checks.

## Workflow follow-up

- Archive `plugin-local-events` and `plugin-view-surfaces` before this change.
- Archive this change after review, sync the deltas and verify the archived result.
