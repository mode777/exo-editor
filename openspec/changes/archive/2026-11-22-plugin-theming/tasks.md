# Tasks

## 1. Contract and SDK theme surface

- [x] 1.1 Add `docs/contracts/plugin-styling.md` with the theme attribute, helper semantics, token table, three palettes and contrast rules; verify every token named in the contract exists in the stylesheet test.
- [x] 1.2 Add `packages/plugin-sdk/src/theme.ts` with `applyTheme`, `followTheme` and their option types; verify the jsdom unit tests cover initial application, permission gating, change delivery, callback order, cleanup and a custom document.
- [x] 1.3 Add `packages/plugin-sdk/src/theme.css` with complete dark, light and high-contrast blocks plus the pre-handshake media fallback; verify the CSS test checks every theme-dependent token in every block and the focus contrast.
- [x] 1.4 Add the `./theme` and `./theme.css` package exports and CSS side-effect metadata; verify a template build that imports both resolves the source and keeps the stylesheet.
- [x] 1.5 Bump the SDK package/constants to `1.8.0` and update the dependent workspace manifests; verify `npm install` and `npm run typecheck` succeed.

## 2. SDK documentation

- [x] 2.1 Extend `docs/contracts/plugin-sdk.md` with the theme entry point, helper behavior and additive `1.8.0` note; verify the contract's version table and package version agree.
- [x] 2.2 Update `packages/plugin-sdk/README.md` with the helper import, CSS import and `followTheme` example; verify the named exports exist and the example typechecks by inspection.
- [x] 2.3 Update `docs/contracts/events.md` so the resolved-token note points at the separate styling contract while keeping `theme/changed` payloads unchanged; verify no contract claims resolved CSS properties travel over the protocol.

## 3. Reference code plugin

- [x] 3.1 Import `@exo/plugin-sdk/theme.css`, replace the plugin-owned palette with the SDK tokens and keep Monaco on its own `vs`/`vs-dark`/`hc-black` mapping; verify the production build succeeds.
- [x] 3.2 Replace the manual `theme/changed` subscription with `followTheme` and its `onTheme` callback; verify the existing theme-selection unit test and the code-plugin build pass.
- [x] 3.3 Run the code-plugin unit tests and the shell's SDK conformance test; verify the SDK helper is exercised without adding Monaco to the shell bundle.

## 4. Author guide and skill

- [x] 4.1 Add `docs/guide/styling.md` covering the recommended setup, token usage, native controls, editor-library mapping, high contrast, contrast/focus/reduced-motion rules and the two-theme checklist; verify every relative link and named repository path against the guide quality test.
- [x] 4.2 Link styling from `docs/guide/README.md`, add the theming section to `docs/guide/sdk.md`, and update the template README to point headless authors at the option; verify the guide quality tests and npm-script scan pass.
- [x] 4.3 Add the styling step to `.agents/skills/create-exo-plugin/SKILL.md` with the helper call, token CSS example, light/dark/high-contrast verification and troubleshooting row; verify the skill's commands, paths and SDK imports match the implemented package.
- [x] 4.4 Update `README.md`, `AGENTS.md` and `ROADMAP.md` with the post-layer-10 `plugin-theming` follow-up and its SDK/shell versions; verify the roadmap status text matches the release metadata.

## 5. Release metadata

- [x] 5.1 Bump the shell package and `SHELL_VERSION` to `0.7.0`; verify `apps/shell/src/version.test.ts` passes.
- [x] 5.2 Add the dated `CHANGELOG.md` entry and update `docs/releases.md` with shell `0.7.0` and SDK `1.8.0`; verify `apps/shell/src/quality/changelog.test.ts` passes.

## 6. Verification

- [x] 6.1 Run the full local gate from `AGENTS.md`: lint, format check, typecheck, unit tests, shell build, budget, CSP, custom elements, no-SDK, no-Monaco, template build/copy, code build/copy and secret check.
- [x] 6.2 Run `openspec validate --all` and `openspec validate plugin-theming --strict` plus the repository guide, changelog and composition quality tests; verify the new spec and both deltas validate.
- [x] 6.3 Deploy the change and verify on the deployed URL that the reference code plugin follows the initial light/dark theme and a live toggle, and that the styling guide and skill links resolve; record the deployed commit and date in the design.

## Workflow follow-up

- Archive `plugin-theming` after the deployed verification is recorded and sync its deltas into `openspec/specs/`.
- Verify the archived result with `openspec validate --all`.
