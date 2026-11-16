# AGENTS.md

Exo Editor is a frontend-only, serverless editor shell. **The shell is the
product; editors are plugins.** Plugins are untrusted cross-origin iframes; the
shell owns the workbench, workspace access and consent.

**Current state:** layers 0-8 are complete and archived. Layer 9 (the Monaco
reference plugin) is next. The parallel Stratofold provider track (P1) is
documented and blocked on its client's npm publication; it does not gate the
numbered layers. The contracts are ratified, and the shell app (`apps/shell`)
builds, tests and deploys to GitHub Pages through CI. Do not scaffold code ahead
of the [roadmap](./ROADMAP.md) layer you were asked to work on, and do not invent
commands or scripts that do not exist yet.

## Read this first

| Document | Why |
| --- | --- |
| [`docs/vision.md`](./docs/vision.md) | Product intent, principles, non-goals |
| [`docs/architecture.md`](./docs/architecture.md) | Runtime model, lifecycle, trust boundaries, decisions D1-D17 |
| [`docs/contracts/`](./docs/contracts/) | Normative contracts; ratified by `define-core-contracts` and mirrored in `openspec/specs/` |
| [`docs/contracts/plugin-sdk.md`](./docs/contracts/plugin-sdk.md) | Typed plugin client, origin rules, compatibility policy and template |
| [`docs/providers/stratofold.md`](./docs/providers/stratofold.md) | Remote-provider track, upstream status and npm blocker |
| [`ROADMAP.md`](./ROADMAP.md) | Layer order, one OpenSpec change per layer, exit criteria |

## Hard invariants

These are decisions, not suggestions. Changing one requires an OpenSpec change.

- **No backend, no proxy, no bundled or server-held secrets.** Static hosting
  only. The browser talks to the filesystem, the remote workspace provider and
  plugin origins directly. A user-supplied remote-provider credential is
  shell-owned (D17): never bundled, never placed in a URL, never sent to a
  plugin frame.
- **The shell owns all filesystem access.** Plugins never receive a
  `FileSystemHandle`, a `File`, or a `Blob` from the shell - only bytes they
  explicitly requested through `plugin/request-file`.
- **Sandbox depends on origin.** Cross-origin plugin frames get
  `sandbox="allow-scripts allow-same-origin"` and keep their own storage.
  First-party plugins on the shell origin are allowed, but get `allow-scripts`
  only: an opaque origin with no storage, cookies or parent DOM. Never give a
  same-origin frame `allow-same-origin`. Its messages report
  `event.origin === "null"`, so identity is the iframe instance plus the session
  id echoed in `plugin/ready`, and consent must say it cannot be isolated by
  origin.
- **Consent covers a page root, not individual pages.** The root is the directory
  of the controller entry (`runtime.entry`). Editor pages and later documents may
  be siblings or descendants of that root; parents and unrelated directories are
  rejected after normalization. Adding a page inside the root does not re-prompt
  (D14). Consent is still shown for every plugin, first-party included.
- **Consent before code.** No iframe is mounted until the manifest validates and
  the user approves the exact origin plus a capability fingerprint. Widening
  permissions or globs re-prompts; display metadata does not.
- **A workspace switch resets everything workspace-scoped:** tabs, plugin
  registrations, handler sessions, watchers, caches, plugin settings. Global
  layout and theme survive (D7).
- **`exo.json` and `/.exo/**` are shell-only.** No plugin message may read or
  write them. Enforce at the session, not in the UI.
- **Paths are normalized, `/`-rooted, and containment-checked after resolution.**
  Reject backslashes, `..`, NUL and empty segments; never percent-decode.
- **The shell never parses editor content.** File bytes move only on request and
  on save; dirty state is reported by the plugin, not inferred.
- **Reuse, do not fork.** `vscode-workbench` is an npm dependency composed through
  props (`views`, `renderDocument`, `commands`, `menus`, `quickOpen`,
  `fileIcons`, `statusBar`, `initialSession`). Never copy its demo layer or patch
  its source.
- **Upstream's file tree and documents are mocks.** Verified against
  `vscode-workbench@0.1.3`. Only the tab/layout/command shell is real; Exo must
  implement the real explorer and document area, not ship the mock data.

## Open decisions that block work

Check [`docs/architecture.md#8-decisions`](./docs/architecture.md) before
starting a layer. No decision is open: D12 keeps the SDK/template and reference
plugin in this repository through v1, with a split reconsidered after layer 9.
First-party plugins may share `<owner>.github.io` (D5), and the code plugin is
expected to ship as a child path of the shell site.

## Working rules

- Work directly on `main`. Do not create branches, worktrees or pull requests
  unless the user explicitly asks for one.
- Every change is deployed to GitHub Pages. Pushing to `main` runs the CI
  `verify` job and, when it passes, deploys `apps/shell/dist` to
  `https://mode777.github.io/exo-editor/`. Treat the deploy as part of done, not
  an optional follow-up.
- Verify behaviour and exit criteria against the deployed URL. Never use a local
  dev server, a local build or a local browser page as verification evidence.
  Local commands are development aids; CI is the gate and the deployed site is
  the acceptance surface. If something cannot be verified against the deployed
  site, say so and leave the acceptance task open.
- Contracts before consumers. If implementation needs behaviour the contract
  does not describe, update the contract and its OpenSpec spec in the same
  change - do not add an undocumented message, field or provider method.
- Provider-specific analysis, upstream status and blockers live in
  `docs/providers/<provider>.md` and are linked from `ROADMAP.md`; do not
  duplicate them in a layer change.
- One layer, one OpenSpec change, using the change name in `ROADMAP.md`
  (`define-core-contracts`, `scaffold-shell-app`, ...). Do not batch layers.
- Keep `docs/contracts/`, the matching `openspec/specs/` requirement text and
  `ROADMAP.md` status consistent. Stale duplication is worse than no duplication.
- When a layer lands, update its roadmap row and exit criteria, and add the new
  real commands to the section below.
- Security-relevant changes (origin checks, sandbox attributes, path
  containment, consent fingerprint) need a test that fails when the check is
  removed, not just a passing demo.

## Verification

Install once from the repository root:

```bash
npm install        # npm ci in CI
```

| Check | Command |
| --- | --- |
| Lint | `npm run lint` |
| Format | `npm run format:check` (write with `npm run format`) |
| Typecheck | `npm run typecheck` |
| Unit tests | `npm test` |
| Build | `npm run build` |
| Bundle budget | `npm run budget` |
| Deployed CSP check | `npm run check:dist-csp` (after a build) |
| Custom elements check | `npm run check:dist-elements` (after a build) |
| SDK absent from shell bundle | `npm run check:dist-no-sdk` (after a build) |
| Monaco absent from shell bundle | `npm run check:dist-no-monaco` (after a build) |
| Template build | `npm run build:template` |
| Template deploy copy | `npm run deploy:copy-template` (after the shell build and dist checks) |
| Code plugin build | `npm run build:code` |
| Code plugin deploy copy | `npm run deploy:copy-code` (after the shell build and dist checks) |

Dev server: `npm run dev` serves `http://localhost:5173/exo-editor/`. It is a
development aid, not a verification target.

Plugin fixture: `npm run dev:plugin` serves the stub at
`http://localhost:5174/` with CORS and JSON content types. Use
`http://localhost:5174/exo-manifest.json` in `exo.json`; the deployed same-origin
copy is at `https://mode777.github.io/exo-editor/plugin-host-fixture/exo-manifest.json`.
`/no-cors/exo-manifest.json`, `never-ready-manifest.json`,
`widened-manifest.json` and `duplicate-manifest.json` are the negative fixtures.
The controller page reports its storage observation and registration-mode state in
its title and `#observation` element. The fixture also implements file editors:
`**/*.txt` reads, reports dirty and saves with a marker; `**/*.repeat.txt`,
`**/*.append.txt` and `**/*.neverack.txt` select the repeated-read, append-marker
and ignored-dispose variants; `**/*.events.txt` subscribes to the four event
topics and records subscription sequences and events. Editor state is mirrored
into the page title and `#observation`; see
`apps/shell/public/plugin-host-fixture/README.md` for the manual checks.

Plugin template: `npm run dev:template` serves the SDK-built starter at
`http://localhost:5175/` with CORS. Use
`http://localhost:5175/exo-manifest.json` in `exo.json`. The deployed same-origin
copy is
`https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json`; the
protocol-mismatch diagnostic is `exo-manifest-mismatch.json` next to it. The
template uses no storage and works under the stricter same-origin sandbox. See
`packages/plugin-template/README.md` for the manual checks.

Reference code plugin: `npm run dev:code` serves the Monaco editor at
`http://localhost:5176/` with CORS. Use
`http://localhost:5176/exo-manifest.json` in `exo.json`. The deployed same-origin
copy is
`https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json`; it runs
with `sandbox="allow-scripts"` and no storage. The example workspace is
`examples/code-plugin-workspace/`. See `apps/code-plugin/README.md` for the
manual checks and the 5 MiB guard.

The deployed verification surface is
`https://mode777.github.io/exo-editor/`. Every push to `main` runs the gate below
and deploys on success; behaviour and exit criteria are demonstrated there, never
from a local dev server or local build.

The full gate that must pass before a PR is the CI `verify` job:

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
node apps/shell/scripts/check-bundle-budget.mjs apps/shell/dist apps/shell/budget.json
node apps/shell/scripts/check-dist-csp.mjs apps/shell/dist/index.html
node apps/shell/scripts/check-dist-elements.mjs apps/shell/dist
npm run check:dist-no-sdk
npm run check:dist-no-monaco
npm run build:template
npm run deploy:copy-template
npm run build:code
npm run deploy:copy-code
```

The budget, CSP and custom-element checks run before the plugin copies, so the
budget measures the shell only; the copies add the template and code-plugin child
paths to the deployed artifact.

Specs and change proposals still validate with `openspec validate --all`.

## Repository map

```text
docs/vision.md          product intent and non-goals
docs/architecture.md    runtime model, trust boundaries, decisions
docs/contracts/         normative contracts, one file per surface
docs/providers/         provider-specific analysis, upstream status, blockers
schema/exo.schema.json  shared JSON Schema for exo.json and exo-manifest.json
packages/plugin-sdk/    typed client for plugin authors
packages/plugin-template/ starter plugin built only on the SDK
ROADMAP.md              layered OpenSpec change plan
openspec/specs/         ratified capabilities
openspec/changes/       active changes; archive when done
```
