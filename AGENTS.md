# AGENTS.md

Exo Editor is a frontend-only, serverless editor shell. **The shell is the
product; editors are plugins.** Plugins are untrusted cross-origin iframes; the
shell owns the workbench, workspace access and consent.

**Current state:** layers 0-10 are complete and archived. Layer 10
(`release-readiness`, archived as `2026-11-16-release-readiness`) adds the
security review, accessibility pass, browser matrix, performance budgets, plugin
author guide, demo workspace, walkthrough and release plan; its deployed
verification is recorded in `ROADMAP.md` and its deltas are synced into the main
specs. Layer 9 (`monaco-code-plugin`) adds the Monaco reference plugin, the
opt-in visible handler surface and its child-path deployment. A post-layer-9
change (`plugin-initiated-save`, archived as
`2026-11-16-plugin-initiated-save`) adds the id-less `plugin/request-save` intent
and Ctrl/Cmd+S in the reference editor. The post-layer-10 change
`plugin-file-picker` (archived as `2026-11-21-plugin-file-picker`) adds the
user-mediated workspace picker, the `capabilities.filePicker` support bit and
SDK `1.2.0`; its deployed verification is recorded in the archived change
design. The post-layer-10 change
`plugin-workspace-listing` adds permissioned one-level directory listing, the
`capabilities.directoryListing` support bit and SDK `1.3.0`; its deployed
verification is also recorded in the change design. The post-layer-10 change
`explorer-workspace-header` (archived as
`2026-11-20-explorer-workspace-header`) adds the explorer workspace header with
New File, New Folder, Refresh and Collapse Folders icon actions, and expands
directories on a single click; its deployed verification is recorded in the
archived change design. The post-layer-10 change `plugin-local-events`
(archived as `2026-11-20-plugin-local-events`) adds identity-scoped `local/`
topics, the correlated `plugin/publish` acknowledgement,
`capabilities.localEvents` and SDK `1.4.0`; its deployed verification is recorded
in the archived change design. The post-layer-10 change `plugin-view-surfaces`
(archived as `2026-11-20-plugin-view-surfaces`) adds `contributes.panels`,
`contributes.contentViews`, the `view` frame mode,
`plugin/open-file`, `plugin/open-view`, `plugin/request-panel` and SDK `1.5.0`;
its deployed verification is recorded in the change design and `ROADMAP.md`. The
post-layer-10 change `plugin-commands` (archived as
`2026-11-20-plugin-commands`) adds `contributes.commands`, the
`shell/command` and `plugin/command-result` messages, shell-owned command
surfaces and SDK `1.6.0`; its deployed verification is recorded in `ROADMAP.md`.
The post-layer-10 change `plugin-file-creation` (archived as
`2026-11-20-plugin-file-creation`) adds `contributes.newFiles`, the shell-owned
Save As dialog, `plugin/request-new-file` / `shell/new-file-result`, the
create-only `WriteOptions.createOnly` path and SDK `1.7.0`; its deployed
verification is recorded in the archived change design and `ROADMAP.md`.
The post-layer-10 change `plugin-theming` (archived as
`2026-11-22-plugin-theming`) adds the optional `@exo/plugin-sdk/theme` helper,
`@exo/plugin-sdk/theme.css` and SDK `1.8.0`, plus the styling contract,
author-guide page and skill step; shell `0.7.0`.
The post-layer-10 change `command-invocation-user-activation` (archived as
`2026-11-23-command-invocation-user-activation`) adds a live-command grant for
`plugin/request-new-file` and `plugin/request-files`, so a command target frame
can open a shell-owned dialog without DOM focus; shell `0.8.0`, protocol `1`,
manifest schema `1` and SDK `1.8.0` are unchanged.
Shell `0.8.1` is a bug fix: the sash paints above visible plugin frames and
keeps pointer capture through a drag, so resizing the secondary side bar no
longer freezes, jumps or stays active after release. Protocol `1`, manifest
schema `1` and SDK `1.8.0` are unchanged. Shell `0.8.2` fixes switching between
content-view tabs, `0.8.3` keeps a companion visible only while its tab is
active, and `0.9.0` adds the active content-view context and `view/active`
(SDK `1.9.0`). The post-layer-10 change `editor-bound-panels` adds the `bottom`
panel location, `activeEditor`, `editor.instanceId`, the targeted `editor/active`
topic and SDK `1.10.0`; shell `0.10.0`, protocol `1` and manifest schema `1`.
The parallel Stratofold provider track
(P1-P3) is archived and verified; it does not gate the numbered layers. The
contracts are ratified, and the shell app (`apps/shell`) builds, tests and
deploys to GitHub Pages through CI. Do not scaffold code ahead of the [roadmap](./ROADMAP.md) layer
you were asked to work on, and do not invent commands or scripts that do not
exist yet.

## Read this first

| Document                                                                 | Why                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [`docs/vision.md`](./docs/vision.md)                                     | Product intent, principles, non-goals                                                      |
| [`docs/architecture.md`](./docs/architecture.md)                         | Runtime model, lifecycle, trust boundaries, decisions D1-D19                               |
| [`docs/contracts/`](./docs/contracts/)                                   | Normative contracts; ratified by `define-core-contracts` and mirrored in `openspec/specs/` |
| [`docs/contracts/plugin-sdk.md`](./docs/contracts/plugin-sdk.md)         | Typed plugin client, origin rules, compatibility policy and template                       |
| [`docs/contracts/plugin-styling.md`](./docs/contracts/plugin-styling.md) | Optional theme helper, token sheet and the three palettes                                  |
| [`docs/guide/`](./docs/guide/README.md)                                  | Author handoff: quickstart, manifest, protocol, SDK, styling, hosting, consent, testing    |
| [`docs/security-review.md`](./docs/security-review.md)                   | Trust-boundary control map, mutation evidence, findings                                    |
| [`docs/accessibility.md`](./docs/accessibility.md)                       | A11y scope, automated checks, manual script, upstream exceptions                           |
| [`docs/browser-support.md`](./docs/browser-support.md)                   | Supported, unsupported and unverified browser/provider combinations                        |
| [`docs/performance.md`](./docs/performance.md)                           | Runtime budgets, reference environment and measurements                                    |
| [`docs/walkthrough.md`](./docs/walkthrough.md)                           | Recorded acceptance path for the release                                                   |
| [`docs/releases.md`](./docs/releases.md)                                 | Version axes, release checklist, deprecation and breaking changes                          |
| [`docs/providers/stratofold.md`](./docs/providers/stratofold.md)         | Remote-provider track, upstream status and npm blocker                                     |
| [`ROADMAP.md`](./ROADMAP.md)                                             | Layer order, one OpenSpec change per layer, exit criteria                                  |

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
- **Handler frames are hidden unless opted in.** Registration frames are always
  hidden. A contribution with `rendering: "frame"` may display its handler iframe
  in the active document area; the tab, breadcrumbs, Save action and notices stay
  outside the frame, a tab switch hides without disposal, and the plugin never
  receives a shell DOM node. The default remains `"hidden"`.
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
- **A plugin may request a save, but never authors the write.** `plugin/request-save`
  is an id-less intent; content and `ifVersion` still come only through the
  shell-initiated `shell/request-save` round trip.
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

| Check                               | Command                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Lint                                | `npm run lint`                                                         |
| Format                              | `npm run format:check` (write with `npm run format`)                   |
| Typecheck                           | `npm run typecheck`                                                    |
| Unit tests                          | `npm test`                                                             |
| Build                               | `npm run build`                                                        |
| Bundle budget                       | `npm run budget`                                                       |
| Deployed CSP check                  | `npm run check:dist-csp` (after a build)                               |
| Custom elements check               | `npm run check:dist-elements` (after a build)                          |
| SDK absent from shell bundle        | `npm run check:dist-no-sdk` (after a build)                            |
| Monaco absent from shell bundle     | `npm run check:dist-no-monaco` (after a build)                         |
| No credentials in deployed artifact | `npm run check:dist-secrets` (after the shell build and plugin copies) |
| Template build                      | `npm run build:template`                                               |
| Template deploy copy                | `npm run deploy:copy-template` (after the shell build and dist checks) |
| Code plugin build                   | `npm run build:code`                                                   |
| Code plugin deploy copy             | `npm run deploy:copy-code` (after the shell build and dist checks)     |

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

Release demo: `examples/demo-workspace/` declares both deployed plugins and
includes files for the code plugin, the template plugin and the shell text
surface. Use it with `docs/walkthrough.md` for the release acceptance path; the
deployed manifests are
`https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json` and
`https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json`.

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
npm run check:dist-secrets
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
docs/guide/             plugin author guide
docs/security-review.md trust-boundary controls, mutation evidence, findings
docs/accessibility.md   accessibility scope, evidence and manual script
docs/browser-support.md supported, unsupported and unverified combinations
docs/performance.md     runtime budgets and measured results
docs/walkthrough.md     recorded release acceptance path
docs/releases.md        version axes, release checklist and communication
schema/exo.schema.json  shared JSON Schema for exo.json and exo-manifest.json
CHANGELOG.md            release history
apps/code-plugin/       Monaco reference plugin, child-path deploy
examples/               example workspaces (code plugin and release demo)
packages/plugin-sdk/    typed client for plugin authors
packages/plugin-template/ starter plugin built only on the SDK
ROADMAP.md              layered OpenSpec change plan
openspec/specs/         ratified capabilities
openspec/changes/       active changes; archive when done
```
