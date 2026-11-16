# Proposal

## Why

Layers 0-9 and the Stratofold provider track built and deployed the system, but
v1 still cannot be handed to someone who did not build it. The evidence is
scattered across archived changes and roadmap prose, Exo-owned surfaces have
never had an accessibility pass, the supported browser matrix is implied rather
than stated, performance budgets stop at bundle size, plugin authors have
contracts but no guide, and there is no demo workspace, walkthrough or release
communication plan. Layer 10 turns the shipped system into a release with
reviewable evidence and author-facing documentation, and fixes only the gaps
those passes find.

## What Changes

- Add a security review record that maps every trust-boundary control (origin and
  source validation, consent-before-code, sandbox selection, path containment,
  reserved paths, CSP, payload and size limits, consent fingerprint, shell-owned
  credentials, secret-free delivery) to its contract requirement, enforcement
  point and regression test, with findings resolved or accepted in writing.
  Mutation-check each control and add any missing regression test; add a
  deployed-artifact secret scan to CI.
- Add an accessibility pass for every Exo-owned surface: tree and dialog
  semantics, focus trap/Escape/restore, keyboard operation, live-region
  announcements, visible focus and WCAG AA contrast in both themes. Verify with
  axe-core scans of Exo-owned surfaces, focus and keyboard regression tests, and
  a contrast test against the pinned workbench token palettes; document upstream
  chrome exceptions with rationale.
- Publish the supported browser matrix (Chromium folder workspaces, Firefox
  folder workspaces explicitly unsupported, remote workspaces per verified
  evidence, Safari unverified, mobile out of scope) and require the runtime
  unsupported states to match it.
- Record runtime performance budgets for plugin frame startup, a 10k-entry
  directory listing and a 1 MiB file open/save, measured against the deployed
  shell on a named reference environment, plus a structural test that the
  explorer lists lazily and performs no per-entry `stat`. The existing bundle
  budget stays CI-enforced.
- Add `docs/guide/`: quickstart, manifest, protocol, SDK, hosting/CORS, consent
  and examples/troubleshooting pages that let an author build a plugin without
  reading shell source. Validate internal links, manifest examples and
  referenced paths, and record a guide-only dry run.
- Add `examples/demo-workspace/` (shell text, reference code plugin and template
  plugin in one workspace) and `docs/walkthrough.md` with numbered steps and
  committed screenshots captured from the deployed URL. No video is recorded.
- Add the release versioning and communication plan: version axes (shell,
  protocol major, manifest schema, SDK major), release checklist, changelog
  policy, deprecation timeline and breaking-change upgrade-note requirement,
  plus `CHANGELOG.md` with the first release entry. No version bump is made in
  this change.
- Update `README.md`, `AGENTS.md`, `ROADMAP.md`, the contract cross-links and
  the deployed-evidence record so they describe the shipped system, including
  the stale Stratofold "blocked" status.

**Explicit non-goals:** new runtime features or provider methods, any protocol,
manifest, consent or sandbox change, a version bump or new release tag, Firefox
or Safari folder-workspace support, a CI timing harness (runtime budgets are
documented manual checks per this change's decision), video production, a docs
site, WCAG certification, screen-reader certification, and packaging or
publishing the SDK.

## Capabilities

### New Capabilities

- `plugin-authoring`: the author-facing handoff package - a self-contained guide,
  the demo workspace, the deployed walkthrough record, and the versioning and
  release communication plan that tells authors how deprecations and breaking
  changes reach them.

### Modified Capabilities

- `editor-shell`: add requirements for accessible shell surfaces, recorded
  runtime performance budgets, and a security review record with regression
  evidence.
- `workspace-access`: add the documented browser support matrix and require the
  runtime unsupported states to match it.

## Impact

- `docs/security-review.md`, `docs/accessibility.md`, `docs/browser-support.md`,
  `docs/performance.md`, `docs/releases.md`, `docs/walkthrough.md`,
  `docs/media/walkthrough/*.png`, `docs/guide/*.md` (new).
- `examples/demo-workspace/` (new): `exo.json`, sample files and a README.
- `CHANGELOG.md` (new) and cross-links from `README.md`, `AGENTS.md`,
  `ROADMAP.md`, `docs/architecture.md`, `docs/contracts/plugin-protocol.md`,
  `docs/contracts/plugin-manifest.md` and `docs/contracts/plugin-sdk.md`.
- Shell: ARIA and focus management in the explorer, document area, settings,
  consent, close-prompt and remote-connect dialogs; a shared modal-focus hook;
  `app.css` focus/contrast adjustments; accessibility and performance tests;
  `axe-core` as a development dependency.
- `apps/shell/scripts/check-dist-secrets.mjs` (new), root
  `check:dist-secrets` script and a CI step; no runtime dependency and no
  measurable bundle growth.
- No new network call, no backend, no secret, no wire or manifest schema change,
  and the deployed shell remains the only acceptance surface.
