# Tasks

## 1. Protocol and handler dispatch

- [x] 1.1 Add `capabilities.filePicker` to editor `shell/init`, keep `requestFiles` as the permission bit, and send the support bit from `HandlerSession`; verify a handler test pins both fields and the old-init shape still parses
- [x] 1.2 Add `plugin/request-files` to the editor-phase dispatch with strict shape validation (`id`, optional boolean `multiple`, optional string `directory`), a `workspace:read` check and a correlated `shell/files-selected` reply; verify tests cover the accepted single/multiple shapes, cancellation, malformed payloads, wrong phase and missing permission
- [x] 1.3 Add a `FrameHandle` focus accessor (or an injected focus predicate), gate requests on an active, non-disposing handler whose contribution is `rendering: "frame"`, whose surface is attached and whose iframe has focus, and expose the gate through `HandlerPool`; verify tests deny hidden, inactive, unfocused and disposing handlers and accept an active visible focused one
- [x] 1.4 Add the one-picker-per-frame and per-workspace controller interface, abort the pending request on `HandlerSession.dispose`, and drop any late continuation after disposal; verify tests show no `shell/files-selected` after disposal or workspace switch
- [x] 1.5 Update `docs/contracts/plugin-protocol.md` with the messages, capability bit, phase row, cancellation, limits and security checklist, and align the `plugin-protocol` delta; verify `openspec validate plugin-file-picker --strict` passes
- [x] 1.6 Clarify the `workspace:read` consent text so it states that the plugin can read other workspace files it requests, including a path selected in the picker, without changing the fingerprint; verify the consent component test asserts the clarified text

## 2. Picker controller and shell dialog

- [x] 2.1 Implement the workspace-scoped picker controller with one global pending request, `rate-limited` rejection without queueing, an abort signal and a reset on detach; verify controller tests cover open, second request, cancel, abort and workspace reset
- [x] 2.2 Implement the shell-owned picker dialog with lazy directory listing through `session.forPlugin(pluginId).list`, reserved-entry filtering, breadcrumbs, file-only selection, the 32-path cap and the handler-directory default; verify tests prove `/exo.json` and `/.exo/**` are never listed or returned and that a selected path is re-checked before reply
- [x] 2.3 Apply the optional `directory` hint by normalizing and containing it, falling back silently to the handler directory when absent, invalid or reserved; verify tests cover a valid hint, a missing hint, a traversal attempt and a reserved hint
- [x] 2.4 Add fixed shell-owned disclosure naming the plugin, no plugin-supplied text, and the accessible modal lifecycle (initial focus, Tab trap, Escape, focus return to the plugin frame, keyboard row navigation, bidi-safe paths); verify component tests cover the focus lifecycle and the `editor-shell` accessibility suite still passes, and record the new surface in `docs/accessibility.md`
- [x] 2.5 Wire the dialog and controller into `WorkspaceRuntime`/`DocumentStore`/`HandlerPool`, cancel the picker when the document surface detaches or the tab closes, and close it before a workspace switch; verify integration tests cover tab switch, tab close, plugin removal and workspace switch with a picker open
- [x] 2.6 Verify the picker does not read file content or return stats, versions, handles or blobs; add a test that the reply payload has exactly `paths` and that the subsequent read goes through `plugin/request-file`

## 3. SDK client and compatibility

- [x] 3.1 Extend the SDK editor capabilities type and `shell/init` parser with `filePicker`, defaulting an absent field to `false`; verify parser tests cover a new shell, an old shell and a malformed value
- [x] 3.2 Add `EditorClient.requestFiles(options?)` with local `unsupported-message`, `permission-denied` and `rate-limited` preflight, correlated `shell/files-selected` resolution, malformed-reply rejection and disposal rejection; verify SDK tests cover round trip, cancel, old shell, missing permission, one pending request, shell error, malformed reply and dispose
- [x] 3.3 Bump `@exo/plugin-sdk` and `SDK_VERSION` to `1.2.0`, update the version-pinning tests and `docs/contracts/plugin-sdk.md`, and keep the SDK major equal to the protocol major; verify the documented API exists in the exported type and the compatibility table still passes
- [x] 3.4 Update the `plugin-sdk` delta and the contract editor-client list with `requestFiles()`, the support bit and the manual-path fallback; verify `openspec validate plugin-file-picker --strict` passes

## 4. Fixture and author documentation

- [x] 4.1 Add a visible fixture contribution (for example `**/*.picker.txt` with `rendering: "frame"` and a priority above the generic `**/*.txt` fixture editor) and a hand-rolled picker editor page that sends `plugin/request-files`, displays the selected paths, reads one path through `plugin/request-file` and reports state in `#observation` and the title; verify the fixture build/serve path works and the README lists the manual check
- [x] 4.2 Update `docs/guide/protocol.md`, `docs/guide/sdk.md` and `docs/guide/testing.md` with the picker message, the SDK helper, the `filePicker` detection rule, cancellation and the manual-path fallback; verify every documented command and type name exists and `npm run format:check` passes

## 5. Integration and deployed verification

- [x] 5.1 Run the full local gate: `npm ci`, lint, format check, typecheck, tests, shell build, budget, CSP, custom elements, no-SDK, no-Monaco, template build/copy, code-plugin build/copy, `check:dist-secrets` and `openspec validate --all`; verify every command passes
- [ ] 5.2 Push `main`, confirm the CI `verify` and Pages deploy jobs pass, and confirm the deployed fixture and shell assets are current
- [ ] 5.3 Against the deployed shell, open a `*.picker.txt` document, trigger the picker from the visible fixture, select a file, verify only the path arrives, the plugin reads it, and the document remains dirty/saveable as before
- [ ] 5.4 Against the deployed shell, verify keyboard-only navigation, Escape cancellation, one-picker-at-a-time behavior, hidden/inactive denial, reserved paths absent, tab close, plugin disable and workspace switch while the picker is open
- [ ] 5.5 Record the deployed evidence and the old-shell fallback evidence in the change notes, and update `ROADMAP.md`/`AGENTS.md` if the project tracks this post-v1 follow-up there

## Workflow follow-up

- Archive the change after the deployed evidence and the project's review requirements are satisfied.
- Sync the three deltas into `openspec/specs/` and re-run `openspec validate --all`.
