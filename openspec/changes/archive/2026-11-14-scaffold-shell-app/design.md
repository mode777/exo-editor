# Design

## Context

The repository has ratified contracts (`openspec/specs/`), the vision,
architecture and roadmap documents, and a shared JSON Schema - but no
`package.json`, no application and no pipeline. The reused kit is
`vscode-workbench` at `0.1.3`, verified as an npm dependency composed through
preset props; its file tree, documents and source-control views are deliberate
mocks that Exo must not import. Deployment target is a GitHub Pages project
site under `/exo-editor/`, which cannot set custom response headers - hence the
spec delta that embeds the CSP in the document.

## Goals / Non-Goals

**Goals:**

- A buildable, deployable shell app (`apps/shell`) composed from the kit's
  public exports, with the pipeline gates the later layers will lean on.
- Layout session persistence and theme wiring that already honour D7, so layer
  2's workspace switch keeps them for free.
- A composition seam (explorer, document renderer, quick-open provider, status
  bar) that is explicitly empty rather than mocked, ready to receive real
  implementations in later layers.
- Guard tests that fail when a composition rule is broken (demo imports, CSP
  dropped from the build, budget exceeded).

**Non-Goals:**

- Any workspace provider, file access, `exo.json` handling, plugin host,
  consent, events or plugin code (layers 2+).
- A real document renderer or explorer content; placeholders only.
- Browser support beyond Chromium for anything folder-backed (nothing
  folder-backed exists yet).
- A design system of Exo's own; theme tokens come from the kit.

## Decisions

### D1. npm workspaces, one deployable app

Root `package.json` with `"workspaces": ["apps/*", "packages/*"]`, private,
`engines.node >= 20`. `apps/shell` is the only package in this layer; the
`packages/*` glob is reserved for the SDK and template (D12) so later layers add
packages without moving the root.

*Alternative:* pnpm - rejected; the roadmap names npm and the CI runner needs
nothing npm cannot do.

### D2. Toolchain: Vite + React 19 + TypeScript strict

Vite with `@vitejs/plugin-react`, TypeScript in strict mode, Vitest for unit
tests, ESLint flat config with `typescript-eslint` and Prettier. Versions are
pinned in `package.json` at implementation time; this document does not fix
numbers the registry will have moved by then.

One pin is deliberate: TypeScript stays on 5.9.x even though 7.x exists,
because `typescript-eslint` 8.x supports only `<6.1`. Revisit when the lint
stack supports the native compiler.

*Alternative:* Rspack/webpack - rejected; Vite is named by the roadmap and its
HTML transform covers the CSP injection below.

### D3. Kit pinning and the composition guard

`vscode-workbench` is pinned to `~0.1.3` (minor pinned per
`docs/architecture.md` §7). The composition root is the only module that
imports the preset; it receives Exo's explorer view, document renderer,
commands, menus, quick-open provider, file icons, status bar and
`initialSession`. Two guards enforce the "no upstream demo dependency" rule:

- ESLint `no-restricted-imports` allows only the kit's public entry points
  (`vscode-workbench`, `/react`, `/core`, `/elements/*`, `/styles/*`) inside
  `apps/shell/src`.
- A unit test fails if shell source contains a banned upstream path (demo
  views, mock workspace data, vendored preset source).

*Alternative:* trust code review - rejected; the working rules require a test
that fails when the check is removed.

### D4. The empty composition seam

The explorer view renders an explicit "no workspace open" empty state. The
document renderer renders a placeholder that cannot open a file. The
quick-open provider is registered with an explicitly empty source. Status bar
carries a theme indicator and the no-workspace state. None of these contain
mock data; each is the seam a later layer replaces.

### D5. The layout session is the preset's persisted store

`VSCodeWorkbench` owns layout state and persists theme, region visibility, sash
sizes and active views to `localStorage` under the kit's fixed versioned key
`desktop-ui-template:v1` (verified in the kit's persistence recipe at 0.1.3).
Exo keeps no second layout store: the kit's concepts warn against a second
source of truth for the same fields, and the key is not configurable in `0.1.x`
without ejecting to composition, which D1/D3 reject. The shell therefore relies
on the preset for persistence and adds a robustness test only - with corrupt or
absent stored state the store must hydrate to its documented defaults instead
of throwing. `initialSession` seeds first-run tabs; layer 1 passes an empty
session. Theme lives in the global preset store, not a workspace-scoped one,
which is what makes D7 hold: a workspace switch must never clear this key.

### D6. Baseline commands

Two commands registered through the `commands` prop:

- `exo.theme.toggle` - switches the theme token set immediately and persists.
- `exo.settings.open` - opens a shell-owned settings surface whose first entry
  is the theme preference. The command must have a real effect; layers 3 and 7
  extend this surface.

Menus place the theme and settings entries; the palette lists both. The
open-workspace command is not registered in layer 1: the preset palette renders
every registry entry as enabled and has no disabled state, and patching that
would violate the composition rule. It arrives with the workspace provider in
layer 2 (decision during apply; the roadmap deliverable is adjusted at archive
time).

*Alternative:* show it as an enabled no-op - rejected; an inert entry that looks
runnable is worse than no entry.

### D7. CSP as a build-time document injection

GitHub Pages cannot set response headers, so the policy from the modified
"Shell content security policy" requirement is embedded as a `<meta
http-equiv="Content-Security-Policy">` tag. Directives are exactly the ratified
set (`frame-src https:; connect-src 'self' https:; script-src 'self'`) with no
`default-src` and no added `style-src`, because the kit positions sashes and
panels with inline `style` attributes that a restrictive `style-src` would
block. A tiny Vite plugin injects the tag via `transformIndexHtml` during
`vite build` only: the dev server's HMR preamble is an inline script and would
violate `script-src 'self'`. A unit test asserts the transform output, and the
CI budget job greps `dist/index.html` so a build that loses the tag fails the
pipeline. No third-party font or script origin is introduced, keeping the
document free of external requests.

### D8. Base path and deploy workflow

Vite `base` defaults to `/exo-editor/` (overridable by env for forks). The
workflow builds once with the production base, runs the gates, and on push to
`main` deploys `dist` through `actions/upload-pages-artifact` +
`actions/deploy-pages`. Pull requests run the identical gates minus the deploy
job. All asset URLs are base-relative, which is the standard guard against the
project-site 404 problem.

### D9. Bundle budget

A committed `apps/shell/budget.json` holds gzip byte limits per asset class
(JS entry and chunks, CSS). `scripts/check-bundle-budget.mjs` (Node, no
dependencies) gzips the built assets with a fixed compression level, compares
against the budget, prints measured sizes and exits non-zero on any overage.
The initial budget is committed from the first measured build with roughly 20%
headroom and tightened once stable.

*Alternative:* the `size-limit` package - rejected for now; the hand-rolled
check is small, has no dependency surface and reports in the budget file's own
terms.

### D10. Verification story

Unit tests cover: layout session round-trip and corrupt-state fallback, the
CSP transform output, the budget script (pass, overage, malformed build),
the banned-import guard, and the command registry exposing the three baseline
entries with `exo.workspace.open` disabled. The deployed-URL criteria
(rendering at 1440x900 and narrow width, no body scroll, keyboard navigation,
reload restoring the layout) are verified as a documented manual smoke pass
against the Pages deployment; the layout logic behind reload restoration is
unit-tested. Automating the visual smoke with the verification server's
headless Chrome is a later hardening item, not a layer 1 deliverable.

## Risks / Trade-offs

- [The preset's view contract may not accept Exo's empty explorer as-is] →
  Compose from `vscode-workbench/react` primitives instead of forking or
  patching; record the composition choice in `docs/architecture.md` and raise
  the gap upstream if it is one.
- [Kit menus are pointer-only in 0.1.3 - the context menu does not take focus
  when opened] → Exo's status bar carries a keyboard-focusable "Command
  Palette" button, and the palette itself is fully keyboard operable (Escape
  closes, Enter runs). Re-check on kit upgrades.
- [The bundler drops the kit's side-effect element imports (verified with Vite
  8 and vscode-workbench 0.1.3), leaving `vscode-*` tags unupgraded] → the
  shell registers the peer package's tags explicitly in `main.tsx`, and
  `check-dist-elements.mjs` fails the pipeline if the bundle loses them.
- [GitHub Pages base-path 404s] → base-relative assets via the fixed `base`,
  plus the manual smoke pass on the deployed URL.
- [Upstream ships a breaking minor] → minor pin `~0.1.3`; the upgrade is a
  deliberate change that re-verifies the composition against public types.
- [Meta CSP diverges silently from the ratified directives] → one shared
  constant builds the policy string; the unit test and the CI grep both assert
  it byte-for-byte.
- [Budget check flakiness across CI runners] → fixed gzip level, deterministic
  output, headroom in the initial budget, measured sizes printed on failure.
- [React 19 peer-range conflicts with the kit] → check the kit's peer ranges
  at install time; if a conflict is real, pin React to the highest range the
  kit accepts and record it - do not add overrides speculatively.

## Migration Plan

Nothing to migrate: the repo gains its first build. Merge sequence is scaffold
→ composition → pipeline, each landable independently. Rollback is `git
revert`; Pages serves the previous deployment until the next successful deploy.

## Open Questions

None that block implementation. The exact initial budget numbers and pinned
dependency versions are measured at implementation time and recorded in
`package.json` / `budget.json`.
