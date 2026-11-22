# Tasks

## 1. Manifest and schema

- [x] 1.1 Add optional `companionPanel` to `$defs/contentView` in `schema/exo.schema.json` with the contribution-id reference, and extend `ManifestContentView` and `parseContentViews` in `apps/shell/src/plugins/manifest.ts` with the same-manifest, secondary-location and id-shape checks. Verify `manifest.test.ts` accepts a valid association and rejects an unknown panel, a primary panel, an invalid id and an omitted optional field.
- [x] 1.2 Preserve the association on `RegisteredContentView` and the host snapshot, and add a `host.test.ts` or `registration.test.ts` check that a registered content view retains `companionPanel` after `plugin/register-complete` without creating a panel frame.
- [x] 1.3 Extend the manifest schema-shape assertions in `manifest.test.ts` for the new optional property, and verify the fixture manifest and an author-guide example validate with the parser.
- [x] 1.4 Update `docs/contracts/plugin-manifest.md` and `docs/guide/manifest.md` with the field, validation rules, shared-companion case, engine range `0.6.0` and the fact that the shell owns reveal and hide. Verify the documented example parses with `validateManifest`.

## 2. View-pool companion lifecycle

- [x] 2.1 Add `companionPanel` to `ContentViewInput.view`, define the internal `CompanionPanelChange`/`onCompanionPanel` observer, and emit a show from `openContent` for new and existing instance keys plus a new `revealCompanion(key)` for tab focus. Verify `view-pool.test.ts` observes one show per open/focus and no frame duplication.
- [x] 2.2 Implement the derived orphan check and hide emission for `closeContent`, `closeFor`, `disposeAll` and `detach`, including multiple content records sharing one companion. Verify `view-pool.test.ts` keeps the panel while another instance remains and hides only after the last one closes, with no retained counter.
- [x] 2.3 Verify absent companions are a no-op and an unregistered companion does not affect content opening in the pool tests, and add a mutation check that removing the remaining-record scan makes the shared-companion test fail.

## 3. Runtime and workbench behavior

- [x] 3.1 Wire `onCompanionPanel` into `WorkspaceRuntime`, pass `companionPanel` through `openContentViewWithKey` and `openViewIntent`, and use `showPanel(pluginViewId(identity, panelId), 'secondary')` for show. Verify `runtime.views.test.ts` covers new open, existing-instance focus, command/palette open and cross-plugin open.
- [x] 3.2 Implement hide only when the companion is the active, visible secondary view, using `toggleSecondarySideBar`; cover manual hide, another panel active, and an unregistered or missing companion in `runtime.views.test.ts`. Verify the content view still opens and `plugin/request-panel` behavior is unchanged.
- [x] 3.3 Call `runtime.views.revealCompanion(content.key)` from the `ContentViewSurface` mount effect so clicking back to a content-view tab reveals the companion. Verify `ContentViewSurface.test.tsx` or `runtime.views.test.ts` covers tab switching without a second panel frame.
- [x] 3.4 Verify tab close, close-all, plugin removal via `closeFor`, `disposeAll` and workspace switch hide orphaned companions and preserve a manually selected different secondary panel. Add the `SecondaryViewPicker.test.tsx` regression that selecting the companion panel is still the ordinary manual path with no companion-specific branch.
- [x] 3.5 Add the fixture `companionPanel` association to `apps/shell/public/plugin-host-fixture/exo-manifest.json` (content view `fixture-tutorial` to secondary panel `fixture-inspector`), update its controller registration only if required, and extend `fixture.test.ts` to assert the parsed association. Update the fixture README manual checks for open, refocus, shared instance, last close and manual hide.

## 4. Release, docs and deployed verification

- [x] 4.1 Bump `apps/shell/package.json` and `SHELL_VERSION` to `0.6.0`, add the `CHANGELOG.md` entry naming shell `0.6.0`, manifest schema `1`, protocol `1` and SDK `1.7.0`, and update `docs/releases.md`. Verify `version.test.ts`, `quality/changelog.test.ts` and the SDK conformance test pass with no SDK version change.
- [x] 4.2 Update `ROADMAP.md` and `docs/walkthrough.md` with the post-release change status and the fixture acceptance path; record no roadmap layer or contract drift and verify `openspec validate --all`.
- [x] 4.3 Run the full local gate from `AGENTS.md`: lint, format check, typecheck, unit tests, build, bundle budget, CSP, custom elements, no-SDK, no-Monaco, template/code builds, deploy copies, secrets and `openspec validate --all`; verify every command exits zero.
- [x] 4.4 Push `main`, wait for the CI `verify` job and Pages deploy, then verify on `https://mode777.github.io/exo-editor/` that the fixture content view reveals `fixture-inspector`, refocus reveals it, a manual hide stays until refocus, a shared instance keeps it open, the last close hides it, and an unregistered companion still opens the content view. Record the deployed commit and date.

## Workflow follow-up

- Archive the change after review, sync the deltas into `openspec/specs/`, and verify the archived result.
- Confirm the archived specs and `docs/contracts/` have no stale duplication.
