# Tasks

## 1. Workspace scaffold and toolchain

- [x] 1.1 Create root `package.json` with npm workspaces (`apps/*`, `packages/*`), private, `engines.node >= 20`, and workspace-delegating scripts (`dev`, `lint`, `format`, `format:check`, `typecheck`, `test`, `build`); verify `npm install` succeeds and each script resolves
- [x] 1.2 Scaffold `apps/shell`: Vite + `@vitejs/plugin-react`, React 19, TypeScript strict, `vscode-workbench` pinned `~0.1.3`, `base` defaulting to `/exo-editor/` via env-overridable config; verify `npm run dev` serves the empty app and `npm run build` emits `dist/` with base-relative asset URLs
- [x] 1.3 Add ESLint flat config (eslint 10, typescript-eslint, Prettier) with `no-restricted-imports` allowing only the kit's public entry points under `apps/shell/src`, plus a unit test that fails when shell source references upstream demo views, mock workspace data or vendored preset source; verify the test fails on a temporarily added banned import and passes after removal, and `npm run lint`, `npm run format:check`, `npm test` pass

## 2. Composition root

- [x] 2.1 Verify layout-session persistence through the preset store: theme, region visibility and sash sizes are written to `desktop-ui-template:v1`, restored on reload, and fall back to documented defaults when stored state is missing or corrupt (add a pre-hydration guard only if the store throws); unit tests cover the round-trip and the corrupt-state fallback; verify `npm test` passes
- [x] 2.2 Wire theme tokens and build the composition module passing Exo's explorer view (explicit no-workspace empty state), placeholder document renderer, quick-open provider with an explicitly empty source, file icons and status bar (theme + no-workspace indicator) to `VSCodeWorkbench` via `initialSession` hydration; verify the app renders the empty explorer state and the guard test and lint stay green
- [x] 2.3 Register the baseline commands and menus: `exo.theme.toggle` (switches immediately, persists) and `exo.settings.open` (shell settings surface with the theme preference as first entry), with palette entries; unit test asserts the registry exposes both entries; verify the test passes and the palette behaves in the dev server

## 3. CSP injection

- [x] 3.1 Add a build-only Vite `transformIndexHtml` plugin that injects `<meta http-equiv="Content-Security-Policy">` from one shared directive constant (`frame-src https:; connect-src 'self' https:; script-src 'self'`, no `default-src`, no added `style-src`); unit test asserts the emitted HTML carries exactly those directives and no `unsafe-eval`/`unsafe-inline`; verify `npm run build` output contains the tag and the dev server still runs with HMR
- [x] 3.2 Update `docs/architecture.md` (trust-model CSP paragraph and hosting topology) to state the policy is embedded in the document because Pages cannot set response headers; verify the wording matches the implemented mechanism

## 4. Bundle budget

- [x] 4.1 Add `apps/shell/budget.json` and dependency-free `scripts/check-bundle-budget.mjs` (fixed gzip compression level, per-asset-class limits, prints measured sizes, exits non-zero listing overages); measure the first production build and commit initial limits with roughly 20% headroom; unit tests cover pass, overage and missing/`dist` cases; verify `npm test` passes and the script exits 0 against a real build

## 5. CI and deploy

- [x] 5.1 Add the verify workflow (npm ci, lint, format check, typecheck, unit tests, build, budget check, grep of `dist/index.html` for the meta CSP) running on every pull request and push to `main` with concurrency cancellation; verify the run is green on a PR containing these tasks
- [x] 5.2 Add the Pages deploy job on push to `main`, gated on verify, using `upload-pages-artifact` + `deploy-pages` with the production `base`; verify a merge deploys and the project-site URL loads the shell with base-relative assets
- [ ] 5.3 Verify the gate blocks: open a PR that breaks lint, then typecheck, then a unit test and confirm the required check goes red each time without deploying; verify the budget job fails when `budget.json` limits are temporarily lowered

## 6. Documentation and exit-criteria pass

- [x] 6.1 Replace `AGENTS.md`'s verification placeholder with the real scripts and the full pre-PR gate, matching `package.json` exactly; verify every documented command runs as written from a clean checkout
- [x] 6.2 Run the exit-criteria smoke pass against the deployed URL and record results in the PR: renders at 1440x900 and narrow width with no body scroll, keyboard navigation reaches the primary surfaces and opens/closes the palette, theme toggle applies immediately, reload restores layout and theme, `dist/` contains no plugin or Monaco code; verify each checklist item is demonstrated

## Workflow follow-up

- Archive the change after review; on archive, update `ROADMAP.md`'s layer 1 status and exit criteria, and confirm `openspec validate --all` passes.
