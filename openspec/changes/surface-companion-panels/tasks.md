# Tasks

## 1. Manifest shape and validation

- [x] 1.1 Add `companionPanels` to the `fileEditor` and `contentView` definitions in `schema/exo.schema.json` (array, 1-3 unique contribution ids) while keeping `companionPanel` on `contentView`; verify the schema parses and accepts/rejects the fixture manifests.
- [x] 1.2 Parse `companionPanels` for file editors and content views in `apps/shell/src/plugins/manifest.ts`, normalize the legacy `companionPanel` to a one-item list, and reject both fields on one entry; verify with manifest tests for any location, duplicate ids, duplicate locations, empty/more-than-three lists, unknown ids and the alias.
- [x] 1.3 Update `docs/contracts/plugin-manifest.md` section 3.2 and the field table with the new field, the alias, the 1-3/unique-location rules and the `engines.exo` requirement; verify every listed example validates through the parser.

## 2. Registration and surface metadata

- [x] 2.1 Carry `companionPanels` through `RegisteredEditor`, `RegisteredContentView`, `RegistrationOutcome` and the host snapshot in `apps/shell/src/plugins/registration.ts` and `host.ts`; verify host tests expose the list for both contribution types and drop it on stop.
- [ ] 2.2 Add the matched contribution's companions to `EditorCandidate`, `DocumentEditor` and the document open path in `apps/shell/src/workspace/documents.ts`; verify a document opened with a plugin candidate exposes its companions and a text-surface document exposes none.
- [x] 2.3 Add `companionPanels` to `ContentViewTabInfo`, `ContentViewInput` and the `ViewPool` content path in `apps/shell/src/workbench/tabs.ts` and `plugins/view-pool.ts`; verify view-pool tests open a content view with multiple companions and preserve the list in its handle.

## 3. One runtime companion path

- [x] 3.1 Implement the surface key and `syncCompanions` in `apps/shell/src/workspace/runtime.ts`, with show/hide helpers for primary, secondary and bottom that use the existing region actions and skip a hide when another view is active; verify runtime tests cover each region.
- [x] 3.2 Cover content-view companions in runtime tests: open, reopen an existing instance, tab focus, last close, shared panel across instances, unregistered panel and another panel selected by the user.
- [x] 3.3 Cover file-editor companions in runtime tests: reveal only after `activeEditor` is ready, no reveal while mounting/failed/background, same-contribution switch keeps panels, different-contribution switch diffs them, and clearing the active editor hides them.
- [x] 3.4 Cover manual control and teardown in runtime tests: a dirty/save/theme change does not reopen a manually hidden companion, refocus does, workspace switch and plugin removal hide everything, and an automatic reveal does not move focus.
- [x] 3.5 Remove `CompanionPanelChange`, the `ViewPool` companion callback and its open/close/orphan calls, and the `ContentViewSurface` reveal effect; update the affected tests and add a removal test that fails when the runtime hide or show path is deleted.

## 4. Fixture, guides and release records

- [x] 4.1 Extend the deployed fixture manifest and workspace files with a file editor declaring companions in all three regions and a content view using `companionPanels`, keeping one legacy `companionPanel` entry; verify the fixture README manual checks and the example workspace paths.
- [x] 4.2 Update `docs/guide/manifest.md`, `docs/guide/sdk.md` or the relevant view/panel page, `docs/guide/testing.md`, `docs/walkthrough.md` and the `create-exo-plugin` skill checklist with the companion field, timing and manual checks; verify the documented steps use only deployed fixture paths.
- [x] 4.3 Bump shell `package.json` and `SHELL_VERSION` to `0.11.0`, add the `CHANGELOG.md` entry, update `docs/releases.md` version axes, the `README.md`/`AGENTS.md` current-state summaries and the `ROADMAP.md` post-layer-10 follow-up; verify `npm test` version checks and the changelog/version consistency test.

## 5. Integration and deployment

- [x] 5.1 Run the full `verify` gate locally as a development aid: lint, format check, typecheck, unit tests, build, budget, CSP/elements/no-sdk/no-monaco checks, template/code builds and copies, secrets check; resolve every failure before pushing.
- [x] 5.2 Push `main`, wait for the CI `verify` job and Pages deploy, then verify on `https://mode777.github.io/exo-editor/` with the deployed fixture: content view and file-editor companions in all regions, hide on surface change, shared panels, manual hide until refocus, other-panel preservation, plugin removal and workspace switch, no console errors and bundle budget.
- [x] 5.3 Record the deployed commit, date, fixture URL and observations in the change design's Deployed Verification section; verify `openspec validate --all` passes.

## Workflow follow-up

- Archive `surface-companion-panels` after the deployed verification is recorded and reviewed, then sync the delta into the main specs.
