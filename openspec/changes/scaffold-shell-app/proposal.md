# Proposal

## Why

The contracts are ratified, but the repository still contains no code: no
`package.json`, no app, no build, no deployment. Every later layer depends on a
deployed walking skeleton and on the same verification discipline the reused
workbench kit already has, and those gates are cheapest to stand up before any
workspace or plugin code exists. Layer 1 creates the shell scaffold so layers 2+
land as features in a real pipeline instead of starting one.

## What Changes

- Add an npm workspace rooted at this repository with `apps/shell`: React 19,
  TypeScript, Vite, and `vscode-workbench` pinned to a known minor.
- Create the composition root that passes Exo's own empty explorer view,
  document renderer, command registry, menu definitions, quick-open provider and
  status bar to `VSCodeWorkbench` through public preset props. No upstream demo
  module, mock file tree or vendored source is imported.
- Wire theme tokens and persist the layout session so a reload restores the
  layout and theme.
- Add the commands that need no workspace: theme toggle and settings, with
  palette entries for them; the open-workspace command arrives with the
  workspace provider in layer 2.
- Add CI: install, lint, format check, typecheck, unit test and build on every
  push and pull request; deploy to GitHub Pages on push to `main` with the
  correct project-site `base` path. Pull requests run the same gates without
  deploying.
- Measure the production bundle against a committed size budget so a regression
  cannot land silently.
- Update `AGENTS.md`'s verification section with the real scripts once
  `package.json` provides them, and record the CSP delivery note in
  `docs/architecture.md` (GitHub Pages cannot set response headers, so the
  policy is embedded in the document).

Not included: workspace access, `exo.json` handling, the plugin host, consent,
events, plugin settings, any plugin code or any real file access. Those are
layers 2 and later. Until layer 2 lands there is no workspace to open, so the
explorer renders an explicit empty state.

## Capabilities

### New Capabilities

None. The shell's delivery, composition and privilege invariants are already
ratified under `editor-shell`; layer 1 implements them.

### Modified Capabilities

- `editor-shell`:
  - The shell content security policy is applied to the shell's documents
    instead of sent as a response header, because static GitHub Pages hosting
    cannot set custom headers. The directive set and its guarantees are
    unchanged.
  - Added: the deployed empty shell renders a usable, workspace-free workbench
    (no body scroll, keyboard operable, explicit empty explorer state, no mock
    data).
  - Added: the layout session persists across reload, and theme and layout
    survive a workspace switch (D7).
  - Added: a baseline command surface is available without a workspace.
  - Added: the build measures bundle size against a committed budget and the
    pipeline fails when it is exceeded.

## Impact

- New: root `package.json` with npm workspaces, `apps/shell/` (source, configs,
  tests), `.github/workflows/` (verify + Pages deploy), the bundle budget file
  and its check.
- Changed: `AGENTS.md` verification section, `ROADMAP.md` layer 1 status when
  this change is archived, and a CSP delivery note in
  `docs/architecture.md`.
- Unchanged: `docs/contracts/` surfaces for workspace, manifest, protocol and
  events; the ratified specs other than `editor-shell`; no plugin code, no
  backend, no secrets.
- Compatibility: `vscode-workbench` is `0.x` and its minor is pinned; upgrades
  re-verify the composition surface. React 19 and Vite are pinned in
  `package.json`. The deploy target is a GitHub Pages project site at
  `/exo-editor/`, so all asset URLs are base-relative.
