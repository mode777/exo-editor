# Tasks

## 1. Protocol and shell dispatch

- [x] 1.1 Add `plugin/request-save` to the editor-phase dispatch in `apps/shell/src/plugins/handler.ts`, accept only an id-less message with an absent or empty payload, reject an `id` or non-empty payload as a protocol violation, and invoke an optional `onSaveRequested` callback; verify handler tests cover the accepted trigger, the rejected shapes, wrong phase and disposal
- [x] 1.2 Thread the callback through `HandlerPool` and `WorkspaceRuntime` to `DocumentStore.save(path)`, with runtime guards for plugin surface, active phase and dirty state, and verify a trigger during an in-flight save produces one write while clean, read-only, inactive and switched documents produce none
- [x] 1.3 Keep the existing `shell/request-save` / `plugin/save-content` / `shell/save-result` path and its timeout, conflict and dirty-sequence tests unchanged; verify the new trigger sends no content and cannot choose `ifVersion`
- [x] 1.4 Update `docs/contracts/plugin-protocol.md` and the `plugin-protocol` delta for the message, id-less rule, coalescing and no-op cases; verify the contract and spec text agree and `openspec validate plugin-initiated-save` passes

## 2. SDK client and compatibility

- [x] 2.1 Add `EditorClient.requestSave(): void` that sends one id-less `plugin/request-save` with no payload, creates no pending request and changes no dirty state; verify SDK tests cover the exact envelope and that a closed client sends nothing
- [x] 2.2 Bump `@exo/plugin-sdk` to `1.1.0`, update `SDK_VERSION` and the version-pinning tests, and record the additive minor release in `docs/contracts/plugin-sdk.md`; verify the package major still equals the protocol major
- [x] 2.3 Update the `plugin-sdk` delta and contract editor-client list with `requestSave()` and its fire-and-forget outcome; verify every documented API name exists in the exported type

## 3. Reference editor binding

- [x] 3.1 Add the Monaco Ctrl/Cmd+S command in `apps/code-plugin/src/editor.ts`, gated on local dirty state and `capabilities.write`, calling `requestSave()` and never constructing save content; verify a source test pins the command and the no-content rule
- [x] 3.2 Update `apps/code-plugin/README.md` and the `reference-code-plugin` delta to remove the Ctrl+S limitation and document the shell fallback for pre-change shells; verify the documented behavior matches the source test and every path exists

## 4. Integration and deployed verification

- [x] 4.1 Run the full local gate: `npm ci`, lint, format check, typecheck, tests, shell build, budget, CSP, custom elements, no-SDK, no-Monaco, template build/copy, code-plugin build/copy and `openspec validate --all`; verify every command passes
- [x] 4.2 Push `main`, confirm the CI `verify` and Pages deploy jobs pass, and confirm the deployed code-plugin manifest and assets are current
- [x] 4.3 Against the deployed shell in a same-origin workspace, edit a file, press Ctrl+S inside Monaco, and confirm exactly one shell save, one `shell/save-result`, exact text on disk and a clean dirty state
- [x] 4.4 Against the deployed shell, confirm Ctrl+S is a no-op when clean or read-only, a conflicting external write still leaves the tab dirty and the plugin keeps the buffer, and the shell Save button still works
- [x] 4.5 Run the cross-origin plugin and confirm Ctrl+S round-trips under `sandbox="allow-scripts allow-same-origin"`; record the evidence and update the roadmap status if the project tracks this follow-up

## Workflow follow-up

- Archive the change after the deployed evidence and the project's review requirements are satisfied.
- Sync the four deltas into `openspec/specs/`, update the contract cross-links and re-run `openspec validate --all`.
