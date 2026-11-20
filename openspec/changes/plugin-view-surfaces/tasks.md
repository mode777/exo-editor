# Tasks

Prerequisite: land `plugin-local-events` first so the runtime-owned event bus and the `local/` namespace exist.

## 1. Manifest, schema and host registration

- [x] 1.1 Add `contributes.panels` and `contributes.contentViews` to `schema/exo.schema.json` and `apps/shell/src/plugins/manifest.ts` with the id, title, icon, location and entry rules; verify valid and invalid manifests in unit tests.
- [x] 1.2 Extend `plugin/register` parsing with `panels` and `contentViews` id arrays and make the registration ack additive while preserving the existing `accepted` glob list; verify registration tests for subset, undeclared and duplicate ids.
- [x] 1.3 Extend the host snapshot, status and log with registered panels and content views and remove them on plugin stop; verify host tests and workspace-switch reset.
- [x] 1.4 Add the consent-dialog sections for panels and content views without changing the fingerprint; verify the existing consent fingerprint tests still pass and a new declaration does not change the stored fingerprint.

## 2. Frame sessions and pools

- [x] 2.1 Extract the gate, read/list/picker/events and dispose base from `HandlerSession` and keep the existing handler tests green before adding view behavior.
- [x] 2.2 Implement `ViewSession` with the `view` mode, `shell/init.view`, no file block, the read/list/picker/events path and the dispose flow; verify view handshake, no-file-init and disposal tests.
- [x] 2.3 Add a `ViewPool` for lazy panel mounting, retained hidden frames, per-tab content frames, surface attachment and per-plugin caps; verify lazy, retain, close, removal and cap tests.
- [x] 2.4 Share one runtime-owned `EventBus` between the handler and view pools and verify view frames can subscribe and publish local topics while editor tests stay green.
- [x] 2.5 Generalize `DomFrameTransport` surface handling for panel and content placeholders; verify resize, hide/show and no-reparenting tests.

## 3. Protocol intents

- [x] 3.1 Add `plugin/open-file`, `plugin/open-view`, `plugin/request-panel`, `shell/open-result` and `shell/panel-result` types and validation in both editor and view phases; verify protocol unit tests.
- [x] 3.2 Implement `open-file` with path normalization, containment, reserved-path denial, `workspace:read`, active/visible gating, existence/kind checks and the 50-tab cap; verify each error case.
- [x] 3.3 Implement `open-view` with same-plugin default, cross-plugin `pluginId` resolution, `instanceKey` deduplication, 64 KiB payload validation and `openedBy`; verify same-plugin, cross-plugin, oversized and unknown-target tests.
- [x] 3.4 Implement `request-panel` for the caller's own panels with `show`, `hide` and `toggle`, lazy mount on show, hide-only-if-active and `shell/panel-result`; verify each action and the unknown-panel case.
- [x] 3.5 Add the intent support bits (`openFile`, `openView`, `requestPanel`, `localEvents`) to editor and view `shell/init`; verify an older init shape parses as false.
- [x] 3.6 Reject all intents from registration frames and disposed frames and enforce the ten-per-second budget; verify the mutation tests.

## 4. Shell composition and UI

- [x] 4.1 Derive `workbenchConfig.activityBar.items`, `primarySideBar.views`, `secondarySideBar` and the primary/secondary view registries from the host snapshot; verify primary panel, fallback and dynamic-config tests.
- [x] 4.2 Add the secondary "Select View" header action and palette entries with keyboard operation; verify the picker and focus tests.
- [x] 4.3 Render panel surfaces into the side bars using the transport placeholder and verify hide-on-switch, re-show and no-reparenting behavior.
- [x] 4.4 Add content-view tabs, the closed-`TabKind` adapter, `DocumentArea` resolution and close/close-all disposal; verify tab, close-guard, no-save and workspace-switch tests.
- [x] 4.5 Show plugin names in the activity tooltip, secondary picker and content-view chrome; verify the spoofing guard test.
- [x] 4.6 Add accessible names, roles and live-region behavior for panel, content-view and picker surfaces and verify the axe and keyboard tests.

## 5. SDK

- [x] 5.1 Add the `view` mode to the browser fragment parser and handshake, the `ViewInit` type and the `ViewConnection` union; verify browser and handshake tests.
- [x] 5.2 Implement `ViewClient` over the shared reader/event base with `readFile`, `requestFiles`, `listDirectory`, local events and disposal, and no save/dirty methods; verify tests.
- [x] 5.3 Add `registerPanel(id)` and `registerContentView(id)` to `RegistrationClient` and parse the additive ack; verify registration tests.
- [x] 5.4 Add `openFile`, `openView` and `requestPanel` to both clients with support-bit, permission and 64 KiB preflight; verify each rejection and success case.
- [x] 5.5 Bump `SDK_VERSION` and the package to `1.5.0`, update the compatibility notes and verify typecheck, unit tests and the shell conformance suite.

## 6. Contracts, security and documentation

- [x] 6.1 Update `docs/contracts/plugin-manifest.md` with panels, content views, limits, consent display and the fingerprint exclusion; verify the contract links and examples.
- [x] 6.2 Update `docs/contracts/plugin-protocol.md` with the view mode, init, intents, caps and lifecycle; verify the protocol table and examples.
- [x] 6.3 Update `docs/contracts/plugin-sdk.md` and `docs/contracts/events.md` with the view client, registration helpers and view-frame event access; verify the guide tests.
- [x] 6.4 Update the author guide, `docs/security-review.md`, `docs/accessibility.md`, `docs/performance.md` and `docs/walkthrough.md` with the new surfaces, accepted fingerprint risk, a11y script, lazy-mount budget and acceptance path.
- [x] 6.5 Add the `ROADMAP.md` follow-up and the `CHANGELOG.md` entry naming shell `0.3.0`, protocol `1`, schema `1` and SDK `1.5.0`; verify the changelog test.

## 7. Fixture and deployed verification

- [x] 7.1 Add a primary panel, a secondary panel and a content view to the plugin-host fixture, including a local-event hub and an `open-file`/`request-panel` check; verify the fixture test.
- [ ] 7.2 Verify same-plugin and cross-plugin content views, the 64 KiB rejection message, a hidden-frame denial and the secondary picker on the deployed URL; record the commit and date.
- [ ] 7.3 Run the full local gate from `AGENTS.md`, including lint, format, typecheck, unit tests, build, bundle budget, CSP, custom elements, no-SDK, no-Monaco and secrets checks.

## Workflow follow-up

- Archive `plugin-local-events` before this change and archive this change after review.
- Sync the deltas into the main specs and verify the archived result.
