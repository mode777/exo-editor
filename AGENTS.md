# AGENTS.md

Exo Editor is a frontend-only, serverless editor shell. **The shell is the
product; editors are plugins.** Plugins are untrusted cross-origin iframes; the
shell owns the workbench, workspace access and consent.

**Current state:** documents and contracts only. There is no `package.json`, no
app and no build. Layer 1 creates them. Do not scaffold code ahead of the
[roadmap](./ROADMAP.md) layer you were asked to work on, and do not invent
commands or scripts that do not exist yet.

## Read this first

| Document | Why |
| --- | --- |
| [`docs/vision.md`](./docs/vision.md) | Product intent, principles, non-goals |
| [`docs/architecture.md`](./docs/architecture.md) | Runtime model, lifecycle, trust boundaries, decisions D1-D14 |
| [`docs/contracts/`](./docs/contracts/) | Draft contracts; normative once `define-core-contracts` is archived |
| [`ROADMAP.md`](./ROADMAP.md) | Layer order, one OpenSpec change per layer, exit criteria |

## Hard invariants

These are decisions, not suggestions. Changing one requires an OpenSpec change.

- **No backend, no proxy, no secrets.** Static hosting only. The browser talks
  to the filesystem and to plugin origins directly.
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
starting a layer. No open decision blocks layers 1-7; D12 (SDK/repo split) must
be settled before layer 8. First-party plugins may share `<owner>.github.io`
(D5), and the code plugin is expected to ship as a child path of the shell site.

## Working rules

- Contracts before consumers. If implementation needs behaviour the contract
  does not describe, update the contract and its OpenSpec spec in the same
  change - do not add an undocumented message, field or provider method.
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

No project commands exist yet. Until layer 1 lands, the only checks are:

```bash
openspec validate --all   # specs and change proposals
```

After layer 1, this section must list the real scripts for install, dev, lint,
typecheck, test and build, and the full gate that must pass before a PR. Do not
document a command before `package.json` provides it.

## Repository map

```text
docs/vision.md          product intent and non-goals
docs/architecture.md    runtime model, trust boundaries, decisions
docs/contracts/         normative contracts, one file per surface
ROADMAP.md              layered OpenSpec change plan
openspec/specs/         ratified capabilities
openspec/changes/       active changes; archive when done
```
