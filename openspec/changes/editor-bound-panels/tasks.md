# Tasks

## 1. Schema, manifest and contracts

- [x] 1.1 Add `"bottom"` to the `$defs.panel.properties.location` enum in `schema/exo.schema.json` and to `MANIFEST_PANEL_LOCATIONS`/`ManifestPanelLocation` in `apps/shell/src/plugins/manifest.ts`; verify the manifest schema parity test and the new bottom-panel validation test pass.
- [x] 1.2 Extend `apps/shell/src/plugins/manifest.test.ts` with a valid bottom panel, an unknown location, a bottom companion rejection, the eight-panel limit across locations, and a `0.9.0` engine check that returns `incompatible-engine`; verify the targeted tests fail if the bottom enum or companion rule is removed.
- [x] 1.3 Update `docs/contracts/plugin-manifest.md` for the bottom location, all-location limit, secondary-only companion rule, consent location text and the `engines.exo` guard; verify every changed value matches the schema and validator.
- [x] 1.4 Update `docs/contracts/plugin-protocol.md` for `editor.instanceId`, `activeEditor`, `capabilities.editorContext`, `capabilities.bottomPanel`, the `bottom` view location and the unchanged `plugin/request-panel` shape; verify the `ShellInit` snippet and the view-session section match the implemented field names.
- [x] 1.5 Update `docs/contracts/events.md` for the `editor/active` catalog row, payloads, identity targeting, producer and `from === editor.instanceId`; verify the topic table, the local-event section and the spec delta agree.
- [x] 1.6 Update `docs/contracts/plugin-sdk.md` for SDK `1.10.0`, `view.activeEditor`, `EditorClient.instanceId`, `capabilities.editorContext`, `capabilities.bottomPanel`, the `bottom` location and the typed `editor/active` topic; verify the version table and compatibility note match `packages/plugin-sdk/package.json`.

## 2. Registration, host snapshot and consent

- [x] 2.1 Add `capabilities.bottomPanel: true` to the registration `shell/init` in `apps/shell/src/plugins/registration.ts`; verify `registration.test.ts` asserts the bit and an older-shell fixture without it still parses.
- [x] 2.2 Verify the host snapshot preserves a registered bottom panel with its `bottom` location and resolved entry; add the snapshot scenario to `apps/shell/src/plugins/host.test.ts` and keep the teardown assertion that no bottom entry survives a plugin stop or workspace switch.
- [x] 2.3 Render the bottom location in `apps/shell/src/plugins/ConsentDialog.tsx` ("Bottom panel tab") and update the "side-bar panels" empty hint; verify `ConsentDialog.test.tsx` covers a primary, secondary and bottom panel and that no fingerprint input changes.
- [x] 2.4 Add a consent test that an already-approved plugin adding a bottom panel reopens no dialog and keeps the stored fingerprint; verify the test fails if the fingerprint input includes `contributes.panels`.

## 3. Bottom panels in the workbench

- [x] 3.1 Extend `PanelViewInput`, `ViewHandle`, `ViewInitData` and `ViewPool` panel mounting to accept `bottom`; verify `view-pool.test.ts` mounts a bottom frame with `view.location: "bottom"` and retains it across a detach/attach.
- [x] 3.2 Extend `runtime.showPanel` and `runtime.requestPanelIntent` to resolve the bottom region (`showPanelView`, `toggleBottomPanel`, `bottomPanelVisible && activePanelView === viewId`); verify `runtime.views.test.ts` covers show, hide, toggle, hide-when-another-tab-is-active and the resulting `shell/panel-result`.
- [x] 3.3 Derive bottom panels in `apps/shell/src/workbench/plugin-views.tsx`: fill `views.panel`, enable `config.bottomPanel` only when at least one is registered, preserve declaration/registration order and add no activity-bar or secondary-picker entry; verify `plugin-views.test.tsx` covers the derived config, multiple tabs, the disabled fallback and the plugin-named titles.
- [x] 3.4 Make the bottom `PanelSurface` attach its placeholder only when its tab is the resolved active bottom view, with the same first-view fallback as the preset; verify a component test proves an inactive bottom tab creates no frame and switching tabs attaches the retained frame without a new handshake.
- [x] 3.5 Add the bottom surface to the shell chrome and accessibility checks: tab title names the plugin, the placeholder keeps its accessible region name and the tab strip remains keyboard operable; verify the workbench component test and the axe scan report no Exo-owned violation.
- [x] 3.6 Verify a command targeting a bottom panel reveals it and waits for its frame; add the case to `runtime.commands.test.ts` or the nearest command-target test.

## 4. Active editor context and event

- [x] 4.1 Expose `HandlerSession.instanceId` from the existing frame session id and add `editor: { instanceId }` to `HandlerSession.buildModeInit`; verify `handler.test.ts` asserts the init value is opaque, stable for the frame and different after a remount.
- [x] 4.2 Add `editor/active` to `EVENT_TOPICS`, define `EditorActivePayload` and extend the event tests for the catalog, targeted delivery, sequences and the local-event `from` equality; verify `events.test.ts` fails if the topic or target filter is removed.
- [x] 4.3 Add `activeEditor` to `ViewSessionOptions`/`buildModeInit` and map only `{ pluginId, path, instanceId }`; verify `view-session.test.ts` covers a non-null context, a null context and the absence of any file content.
- [x] 4.4 Implement `WorkspaceRuntime.syncActiveEditor()` from the active tab, document surface/plugin phase and handler instance id; call it on tab changes, document changes, rename, close, handler close and deactivate, and publish `editor/active` only when the context changes; verify `runtime.views.test.ts` or a focused runtime test covers editor-to-editor, editor-to-text, editor-to-content, editor-to-other-plugin, no-tab, rename and remount.
- [x] 4.5 Pass the runtime context into `ViewPool.attach` and filter it by plugin identity before it reaches a view frame; verify a cross-origin same-manifest-id view receives `activeEditor: null` and no `editor/active` event.
- [x] 4.6 Verify a view frame still cannot save or report dirty and that the editor keeps ownership: the existing `plugin/dirty`, `plugin/request-save` and `plugin/save-content` view violations stay covered, and the panel/editor local-event test shows the edit applied by the editor before the normal save.
- [x] 4.7 Add the mutation evidence for this surface: remove the identity filter, the event target and the editor instance id in turn; verify the named cross-plugin, same-id and remount tests fail before restoring the code.

## 5. SDK surface

- [x] 5.1 Extend `packages/plugin-sdk/src/protocol.ts` with `ActiveEditor`, `EditorActivePayload`, `editor/active` in `EVENT_TOPICS`/`EventPayloads`, `ViewInitData.location` `bottom`, `EditorInit.editor`, `EditorCapabilities.editorContext` and `RegistrationCapabilities.bottomPanel`; verify the protocol and type tests compile.
- [x] 5.2 Parse `editor.instanceId` and `activeEditor` in `packages/plugin-sdk/src/init.ts`, defaulting an absent block to `null` and an absent capability to `false`, and reject malformed present values; verify `editor.test.ts`, `view.test.ts` and `handshake.test.ts` cover new-shell and older-shell payloads.
- [x] 5.3 Expose `EditorClient.instanceId`, `ViewClient.activeEditor` and the typed `editor/active` listener; verify the client tests cover a non-null value, an older-shell null and that `activeEditor` has no content or save method.
- [x] 5.4 Accept `view.location: "bottom"` and expose `RegistrationCapabilities.bottomPanel`; verify `view.test.ts` and `registration.test.ts` cover the accepted location, the true bit and the absent-bit fallback.
- [x] 5.5 Bump `packages/plugin-sdk`/`SDK_VERSION` to `1.10.0`, update the shell, template and code-plugin workspace dependencies, and run `npm install`; verify `no-dom.test.ts`, `npm run typecheck` and the SDK test suite pass.
- [x] 5.6 Extend `apps/shell/src/plugins/sdk-conformance.test.ts` to drive a real handler and a real view through the SDK: assert `editor.instanceId`, `activeEditor`, the `editor/active` event and a local-event round trip with the instance id as `from`.

## 6. Fixture, guide and walkthrough

- [x] 6.1 Add a bottom panel and a `**/*.bound.txt` editor to `apps/shell/public/plugin-host-fixture/exo-manifest.json`, bump its `engines.exo` to `>=0.10.0` and update `fixture.test.ts` (including the new editor/panel lists and the shell version used to validate); verify the fixture manifest validates.
- [x] 6.2 Register the new bottom panel in the fixture controller and update `apps/shell/public/plugin-host-fixture/README.md` with the bottom tab, active-editor and local-event observations; verify the controller page still registers every declared editor and the new panel.
- [x] 6.3 Add a fixture bottom-panel page that shows `activeEditor`, subscribes to `editor/active`, requests a snapshot and sends an edit request with the target instance id; verify it renders an empty state when the active tab is a shell text file or another plugin.
- [x] 6.4 Add the bound editor fixture mode: subscribe to `editor/active` and the local topic, check the target id, reply with a snapshot, apply an edit through a small history stack, support an undo request, report dirty and save with the normal marker; verify the deployed observation shows the edit, undo and save.
- [x] 6.5 Update `docs/guide/manifest.md` with a bottom panel example, the `engines.exo` requirement and the secondary-only companion rule; verify the guide quality test and the manifest example validation.
- [x] 6.6 Update `docs/guide/sdk.md` and `docs/guide/protocol.md` with `view.activeEditor`, `EditorClient.instanceId`, the `editor/active` subscription, the local-event target/`from` pattern, the SDK `1.10.0` requirement for bottom panels and the existing active-and-visible gate for `plugin/request-panel`; verify every named API exists and the guide links resolve.
- [x] 6.7 Add the editor-bound panel and bottom panel checks to `docs/guide/testing.md` and a new step to `docs/walkthrough.md`; verify the guide quality test and the walkthrough's relative links.

## 7. Release metadata and quality records

- [x] 7.1 Bump `apps/shell/package.json` and `SHELL_VERSION` to `0.10.0`; verify `apps/shell/src/version.test.ts` passes.
- [x] 7.2 Add the dated `CHANGELOG.md` entry for shell `0.10.0`, protocol `1`, manifest schema `1` and SDK `1.10.0`, with the bottom-panel SDK requirement in the compatibility note; verify `apps/shell/src/quality/changelog.test.ts` passes.
- [x] 7.3 Update `docs/releases.md`, `README.md`, `AGENTS.md` and `ROADMAP.md` with the new versions and the post-layer-10 follow-up; verify the release metadata and guide quality tests pass.
- [x] 7.4 Add the editor-bound panel control row and mutation evidence to `docs/security-review.md`, covering the identity filter, the targeted event, the bottom-tab lazy mount and the no-view-write path; verify the row names the tests added in groups 3-5.
- [x] 7.5 Add the bottom panel and active-editor surfaces to `docs/accessibility.md` (scope, manual script and upstream limitation) and the bottom-panel startup measurement to `docs/performance.md`; verify the documented commands and measured values match the deployed check.
- [x] 7.6 Sweep `docs/` for stale claims that panels are primary/secondary only and that the workbench bottom region is disabled, and update the contract/guide/release pages that name the version axes; verify no stale claim remains and `docs/contracts/plugin-sdk.md` and `docs/releases.md` agree with the package versions.

## 8. Integration verification and deploy

- [x] 8.1 Run the full local gate from `AGENTS.md`: lint, format check, typecheck, unit tests, shell build, budget, CSP, custom elements, no-SDK, no-Monaco, template build/copy, code build/copy and secret check.
- [x] 8.2 Run `openspec validate editor-bound-panels --strict` and `openspec validate --all`; verify every delta validates and the change has no zero-delta error.
- [x] 8.3 Measure the bundle after the feature and update `apps/shell/budget.json` only if the new measured size exceeds the current cap, recording the number and rationale in the design; verify `npm run budget` passes.
- [x] 8.4 Deploy `main`, confirm the CI `verify` job and Pages deploy pass, and verify on `https://mode777.github.io/exo-editor/` with the deployed fixture: secondary and bottom panels appear, two editor tabs update `editor/active`, a panel edit becomes undoable/dirty and saves, a shell text or other-plugin tab shows the empty state, and no cross-identity context leaks.
- [x] 8.5 Record the deployed commit, date, measured bundle and acceptance observations in `design.md` and `ROADMAP.md`; verify the recorded versions are `0.10.0`/`1`/`1`/`1.10.0`.

## Workflow follow-up

- Sync the change deltas into `openspec/specs/` and archive the change as `2026-11-24-editor-bound-panels` (or the archive date) after the deployed verification is recorded.
- Re-run `openspec validate --all` after archiving.
