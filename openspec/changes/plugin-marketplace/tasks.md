# Tasks

## 1. Prerequisite and contracts

- [x] 1.1 Confirm `surface-companion-panels` is archived, shell `0.11.0` is the current version and the deployed site is healthy; verify `openspec list --json`, `cat apps/shell/package.json` and the deployed URL before changing files.
- [x] 1.2 Add `schema/marketplace.schema.json` with `marketplaceSources` and `marketplaceFeed` definitions, the shared limits and strict `additionalProperties: false`; verify it parses with `node -e "JSON.parse(require('fs').readFileSync('schema/marketplace.schema.json','utf8'))"` and its fixtures validate.
- [x] 1.3 Write `docs/contracts/marketplace.md` with the feed and source formats, field tables, limits, issue vocabulary, loading rules, install semantics, trust boundary and deployed paths; verify every JSON example parses and the documented limits match the schema.
- [x] 1.4 Add `marketplace/marketplace.json`, `marketplace/sources.json` and `marketplace/README.md` with the two official listings and the default source URL; verify the feed's manifest URLs are the deployed code-plugin and template paths and the source file points at the official feed.
- [x] 1.5 Add a repository test that reads the official feed, the default sources and both local plugin manifests, and asserts id/name/version/publisher, unique manifest URLs and the expected deployed URLs; verify `npm test --workspace @exo/shell -- --run src/quality/marketplace.test.ts` (or the equivalent vitest filter) passes.

## 2. Deploy assets and CI

- [x] 2.1 Add `apps/shell/scripts/deploy-marketplace.mjs` to resolve `EXO_MARKETPLACE_SOURCES` and `EXO_MARKETPLACE_FEED`, validate both documents structurally and copy them to `apps/shell/dist/marketplace-sources.json` and `apps/shell/dist/marketplace.json` without partial output on error; verify a default run, an override run and an invalid-input run.
- [x] 2.2 Add `apps/shell/scripts/check-marketplace.mjs` (or an equivalent `npm run check:marketplace`) that checks the built artifact's files exist, parse, use schema version 1, respect counts and contain unique HTTPS manifest URLs; verify it passes on a good build and fails on a copied bad fixture.
- [x] 2.3 Wire `deploy:copy-marketplace` and `check:marketplace` into `package.json`, the shell scripts, the CI `verify` job and `AGENTS.md` verification table, placing them after the shell budget and plugin copies and before the secrets scan; verify the workflow order in `.github/workflows/ci.yml`.
- [x] 2.4 Add `check-dist-secrets` coverage or a test that the marketplace assets contain no token, credential or private URL; verify the command fails when a fixture secret is injected and passes on the real feed.
- [x] 2.5 Add a dev-only Vite middleware that serves `marketplace-sources.json` and `marketplace.json` from the top-level `marketplace/` directory without adding them to the production build; verify `npm run dev` serves both and a production build still receives them only through the deploy step.

## 3. Feed parsing and marketplace store

- [x] 3.1 Implement `apps/shell/src/marketplace/feed.ts` with types, constants, URL normalization, source parsing and feed parsing; cover valid input, future version, unknown fields, invalid URLs, duplicate manifests, every limit and hostile display strings in `feed.test.ts`; verify the focused vitest file passes.
- [x] 3.2 Add a parity test that reads `schema/marketplace.schema.json` and pins the parser's constants, required fields, patterns and limits; verify deleting a field or changing a limit in either place fails the test.
- [x] 3.3 Implement `apps/shell/src/marketplace/store.ts` with injectable fetch/timeout/source URL, lazy `ensureLoaded`, bounded concurrent feed loads, abort-on-dispose, per-feed error isolation, catalog flattening and manifest-URL dedupe; cover lazy, timeout, size, CORS/network, one-feed failure, refresh, late result and dedupe in `store.test.ts`.
- [x] 3.4 Add `MarketplaceStore` to `WorkspaceRuntime`, expose a `useMarketplace()` hook and dispose it with the runtime; verify a workspace switch preserves the loaded catalog, a disposed runtime ignores late results, and no workspace session method is called during load.
- [x] 3.5 Add tests that opening Extensions is the only trigger, no iframe or manifest request occurs during catalog load, and a failed source does not block installed management or URL install; verify with the fake fetch and a host spy.
- [x] 3.6 Update `docs/contracts/marketplace.md` with the exact issue codes, timeouts, size caps and "no persistence" rule, and add the loading/error scenarios used by the store tests; verify `openspec validate plugin-marketplace --strict` still passes.

## 4. Management controller

- [ ] 4.1 Implement `apps/shell/src/plugins/management.ts` with normalized-URL lookup, install, set-enabled, remove, consent review/revoke and the save/discard/cancel dirty guard; cover every result and workspace state in `management.test.ts`.
- [ ] 4.2 Add integration tests that install writes one canonical enabled entry, first install creates `exo.json`, duplicate/invalid/read-only/invalid-config/no-workspace cases write nothing, and conflict preserves the external file; verify the tests fail when the guard is removed.
- [ ] 4.3 Add the consent invariant test: after a catalog install, the host fetches the manifest and mounts no frame until approval, and the consent store is consulted; verify the test fails if the install path calls registration directly.
- [x] 4.4 Refactor the current Settings plugin actions onto `PluginManagementController` and extract the reusable status, setting-control and issue components for the details tab; verify the existing settings tests are updated rather than duplicated and all management operations still pass.
- [x] 4.5 Update `docs/contracts/plugin-manifest.md` §2.3 and every guide/spec sentence that says only the settings surface writes `exo.json` to name the Extensions management surface; verify a repository search finds no stale "settings surface is the only writer" claim.
- [x] 4.6 Add security-review control #17 "Marketplace catalog and installation" with requirement, enforcement, regression tests and mutation evidence for feed validation, no auto-install, consent gating and the `exo.json` write; verify the recorded mutation failures are accurate.

## 5. Extensions view

- [x] 5.1 Add the `extensions` primary view definition, register it after `explorer` in `workbenchConfig`, add the activity item and `ctrl+shift+x` focus command, and verify the activity bar order and view switching in tests.
- [x] 5.2 Implement `apps/shell/src/extensions/ExtensionsView.tsx` with the labelled search, Installed section and count, Marketplace section, row layout, refresh action, feed loading/error/empty/offline states, no-workspace state and install/manage disabled explanations; add axe coverage and keyboard/focus tests.
- [x] 5.3 Add the "Install from URL" form to the same view using the shared URL validator and management controller; cover success, invalid URL, duplicate, invalid/read-only workspace and inline issue display.
- [x] 5.4 Merge installed entries from `exo.json` with host records by normalized manifest URL, show feed metadata until the manifest arrives and manifest metadata afterwards, dedupe catalog rows across feeds and preserve declaration/feed order; verify with mixed installed-only, duplicate and failed-plugin fixtures.
- [ ] 5.5 Add VS Code-like styles in `app.css` using the workbench tokens for search, sections, rows, icons, actions, status text, errors and the details layout; verify both themes, high contrast, narrow widths and visible focus, and record the checks in `docs/accessibility.md`.

## 6. Extension details and Settings debug surface

- [x] 6.1 Add shell-view tab metadata to `workbench/tabs.ts`, render it through `DocumentArea`, and implement open/focus-by-manifest-URL, close and workspace-switch behavior; verify no close prompt, no provider write and no interference with content views or active-editor state.
- [x] 6.2 Implement `apps/shell/src/extensions/ExtensionDetails.tsx` with feed/URL source, manifest URL and origin, manifest-over-feed metadata, status/error, permissions, contributions, consent actions, settings, homepage/license links and install/manage actions; add tests for each state and hostile display text.
- [x] 6.3 Move contributed settings from Settings to the details tab using the extracted controls, preserving defaults, validation, workspace scoping, storage warnings and read-only editability; verify settings tests cover the new path and read-only workspaces.
- [x] 6.4 Rewrite the Settings plugin section as **Plugin debugging**: keep raw `exo.json`, issues, runtime status and log; remove the add form, install/enable/remove, consent actions and settings inputs; add a link to Extensions and update focused tests.
- [x] 6.5 Retitle `exo.plugins.open` to **Open Plugin Debugging**, add **Extensions** to the View/Preferences menus and palette, and verify the command/menu tests and the route that opens `exo.json` still select the debug section rather than a document tab.
- [x] 6.6 Update `docs/accessibility.md`, `docs/security-review.md` and `docs/guide/testing.md` with the Extensions/details keyboard script, axe coverage, hostile-feed checks and the removed Settings controls; verify every documented path and control exists.

## 7. Author and release documentation

- [x] 7.1 Add `docs/guide/marketplace.md` covering listing a plugin, the feed envelope, the manifest URL requirement, optional metadata, validation limits, the no-capability rule, local testing and the deploy-time source file; link it from the guide index and manifest guide.
- [x] 7.2 Update `docs/vision.md`, `docs/architecture.md` (D20 and out-of-scope wording), `README.md`, `AGENTS.md`, `ROADMAP.md` and `CHANGELOG.md` with discovery/installation, the Extensions surface, the official feed URL, shell `0.12.0`, marketplace feed schema `1`, and unchanged protocol/manifest/SDK versions.
- [x] 7.3 Update `docs/releases.md` with the marketplace feed schema axis, the deploy-time source override and the release checklist additions; verify the version/changelog consistency test and every stated version.
- [x] 7.4 Update `docs/walkthrough.md` with an Extensions acceptance path (catalog load, install, consent, settings, disable/remove, settings debug) and record the expected observations; verify every named URL and control exists on the deployed site.
- [x] 7.5 Re-measure the shell bundle after the UI lands, update `apps/shell/budget.json` only with the measured value and rationale, and verify `npm run build && node apps/shell/scripts/check-bundle-budget.mjs apps/shell/dist apps/shell/budget.json` passes before plugin copies.
- [ ] 7.6 Update `docs/performance.md` with the Extensions first-load measurement (source + feed requests, time to catalog, no startup request) and the deployed reference environment; verify the numbers come from the deployed URL, not a local dev server.

## 8. Integration and deployment

- [x] 8.1 Run the full local `verify` gate as a development aid: lint, format check, typecheck, tests, build, budget, CSP, custom elements, no-SDK, no-Monaco, template/code builds and copies, `deploy:copy-marketplace`, `check:marketplace` and the secrets scan; resolve every failure before pushing.
- [ ] 8.2 Push `main`, confirm the CI `verify` job and Pages deploy succeed, and confirm `https://mode777.github.io/exo-editor/marketplace.json` and `marketplace-sources.json` return the committed content; record the deployed commit and asset filenames.
- [ ] 8.3 Verify on the deployed URL with no workspace: Extensions loads the official feed, search filters, details open, install is disabled with the folder explanation and Settings shows plugin debugging.
- [ ] 8.4 Verify on the deployed URL with a writable workspace: install an official entry, `exo.json` gets one canonical entry, consent names the manifest origin and capabilities, the plugin activates, details show settings and status, disable/enable/remove work, dirty documents prompt correctly and a feed error leaves installed management usable.
- [ ] 8.5 Verify a read-only workspace, an invalid `exo.json`, a missing feed and an invalid feed each produce the specified explanation and no write, and verify no console error, frame mount or workspace request occurs during catalog loading.
- [ ] 8.6 Record the deployed commit, date, feed URLs, observed states and bundle measurement in the design's Deployed Verification section, update the `ROADMAP.md` follow-up, and verify `openspec validate --all` passes.

## Workflow follow-up

- Archive `plugin-marketplace` after the deployed verification is recorded and reviewed.
- Sync the deltas into the main specs and re-run `openspec validate --all`.
