# Design

## Context

See `proposal.md` for motivation and the delta specs for normative behaviour.
The layer is mostly evidence and documentation wrapped around a working system:

- `apps/shell/src` already separates Exo-owned surfaces (explorer, document
  area, settings, consent, close prompt, remote connect, plugin log) from the
  reused `vscode-workbench` chrome. Dialogs handle Escape and initial focus but
  do not trap focus or restore it; the explorer already exposes
  `role="tree"`/`treeitem` with level, expanded and selected state.
- Theme variables come from the pinned `vscode-workbench` package at
  `node_modules/vscode-workbench/dist/styles/tokens.css`; Exo-owned CSS uses
  those variables except for three overlay scrims.
- The deterministic test harness (`MemoryWorkspaceProvider`, `Session`,
  `frame-test-support.ts`) can exercise 10k entries and plugin frames without a
  browser. Deployed behaviour is verified with Chrome for Testing 131.0.6778.264
  on the build/verification server, as in layers 5-9.
- CI runs the `verify` job then deploys `apps/shell/dist` to GitHub Pages. The
  budget, CSP, custom-element, no-SDK and no-Monaco checks run before the
  template and code-plugin child paths are copied.
- `docs/contracts/` is normative and mirrored in `openspec/specs/`; the author
  guide must point at it, not fork it.

## Goals / Non-Goals

**Goals:**

- Turn the release criteria into reviewable artifacts: a security control map
  with mutation evidence, accessibility evidence for Exo-owned surfaces, a
  browser matrix, recorded performance budgets, an author guide, a demo and
  walkthrough, and a versioning/communication plan.
- Add regression tests where the passes find behaviour that is not already
  guarded, without changing the protocol, manifest, consent or sandbox model.
- Keep the new gates proportional: axe and contrast tests in unit tests, one
  deployed-artifact secret scan in CI, and manual deployed measurements for the
  runtime budgets.

**Non-Goals:**

- New runtime features, provider methods, protocol fields, manifest fields,
  consent rules or sandbox modes.
- Fixing or forking upstream workbench chrome for accessibility. Exceptions are
  documented, not patched.
- A CI timing harness, virtualized tree, video walkthrough, docs site, release
  tag or version bump.
- Claiming Firefox, Safari or mobile support beyond the recorded evidence.

## Decisions

### D1 - One new authoring capability; quality requirements stay with their owners

`plugin-authoring` owns the author-facing handoff (guide, demo, walkthrough,
release communication). Accessibility, runtime performance and the security
review record are ADDED requirements in `editor-shell` because they describe the
product's quality contract; the browser matrix is an ADDED requirement in
`workspace-access` because it classifies provider support. This avoids a
catch-all `release-readiness` spec that would duplicate those owners.

Alternative: one new capability for every layer-10 artifact. Rejected because it
would restate shell and workspace requirements in a second place.

### D2 - Accessibility: axe on Exo-owned surfaces, a shared modal hook, token contrast

- Add `axe-core` as a shell development dependency and a `runAxe(container)`
  helper in `apps/shell/src/test-a11y.ts`. Tests mount Exo-owned surfaces
  directly (`ExplorerView`, `DocumentArea`, settings, dialogs, plugin log) and
  run axe against them. Whole-app scans exclude the upstream workbench root by
  selector and record each excluded rule in `docs/accessibility.md`. jsdom has
  no layout, so axe's `color-contrast` rule is not relied on.
- Add `apps/shell/src/components/useModalDialog.ts`: a hook that moves focus to
  an initial control, cycles Tab and Shift+Tab inside the dialog, closes on
  Escape and restores focus to the previously focused element. `ConsentDialog`,
  `SettingsDialog`, `ClosePromptDialog` and `ConnectRemoteDialog` migrate to it;
  the command palette remains upstream and is documented as an exception.
- Keep the existing tree semantics and add the missing states/keyboard behaviour
  the pass finds (for example `aria-busy` while a directory loads, and Home/End
  if the audit requires them), with regression tests. Do not replace the tree
  with a library.
- Contrast is a deterministic test over the pinned theme tokens: parse the dark
  and light blocks from `vscode-workbench/dist/styles/tokens.css`, compute WCAG
  ratios for every foreground/background pair Exo-owned CSS uses, and assert
  4.5:1 for text and 3:1 for focus indicators and large text. A kit upgrade that
  lowers contrast fails the test and must update the documented pairs.
- `docs/accessibility.md` lists scope, automated results, the manual keyboard
  and screen-reader smoke script, the upstream exceptions with owner, and known
  limitations.

Alternatives: `vitest-axe` (extra wrapper for no benefit), manual audit only
(no regression teeth), patching upstream chrome (violates reuse, do not fork).

### D3 - Runtime performance is a documented deployed measurement, not a CI timing gate

`docs/performance.md` records the budgets, the reference environment, the
procedure and the result table. First values:

| Budget | Ceiling | Measurement |
| --- | --- | --- |
| Plugin frame startup | 2,000 ms | Open a matching file → reference code plugin's usable editor is visible |
| 10k-entry directory listing | 3,000 ms total, 1,000 ms longest task | Expand a directory with 10,000 entries in the deployed shell |
| 1 MiB file open | 1,000 ms | Shell text surface and reference code plugin |
| 1 MiB file save | 1,000 ms | Shell text surface and reference code plugin |

Measure on the verification server with Chrome for Testing 131.0.6778.264
against the deployed URL, five runs after one warm-up, and record the median and
maximum with date and deployed commit. These are release ceilings, not product
SLOs. If the 10k case exceeds the longest-task ceiling, render rows in
`requestAnimationFrame` batches without changing tree semantics; do not
virtualize in this layer. A remaining miss is recorded as accepted with owner
and follow-up, or the release stays blocked.

Add one deterministic structural test: expanding a 10k-entry directory issues a
single `list` call and no per-entry `stat`, so laziness cannot silently regress.
The bundle budget remains the only CI-enforced size gate.

Alternatives: CI wall-clock thresholds (flaky, hardware-dependent), virtualized
tree (a feature with its own a11y cost), no structural test (budget could
regress between releases unnoticed).

### D4 - Security review maps controls, mutation-checks them, and scans the artifact

`docs/security-review.md` has one row per control:

| Control | Contract requirement | Enforcement point | Regression test |
| --- | --- | --- | --- |
| Origin and source validation | plugin-protocol / plugin-host | protocol and session state machines | protocol, registration, handler, SDK conformance |
| Consent before code | plugin-host | host and consent store | host and App consent tests |
| Sandbox by origin | editor-shell / plugin-host | frame creation | frame and App tests |
| Path containment | workspace-access | path and session modules | path and contract tests |
| Reserved paths | editor-shell / plugin-file-editors | session guard | reserved-path tests |
| CSP | editor-shell | HTML policy and build check | `csp.test.ts`, `check-dist-csp` |
| Payload and size limits | plugin-protocol | protocol and handler | limit tests |
| Consent fingerprint | plugin-manifest / plugin-host | consent module | consent tests |
| Shell-owned credentials | remote-workspace | remote store and runtime | remote tests |
| Secret-free delivery | editor-shell | build artifact scan | new dist scan |

For each row, temporarily remove or weaken the check, run the named test, confirm
it fails, and record the mutation. Add tests only where a control lacks one.

Add `apps/shell/scripts/check-dist-secrets.mjs` and a root
`check:dist-secrets` script. It scans `apps/shell/dist` after the template and
code-plugin copies for private-key blocks, GitHub, AWS, OpenAI, Slack, Google
and JWT-shaped credentials, and fails naming the file and pattern. Narrow
patterns keep false positives out; any allowlist entry is documented in the
review. The CI step runs after `deploy:copy-code` so child paths are covered.

Alternatives: an external scanner (network/dependency for a static site), only a
source grep (misses build output), entropy scanning (noisy, not reproducible).

### D5 - The guide links to contracts and is checked mechanically

`docs/guide/` contains `README.md` (quickstart), `manifest.md`, `protocol.md`,
`sdk.md`, `hosting.md`, `consent.md` and `testing.md` (examples,
troubleshooting, review checklist). Each page links to the owning contract for
limits, error codes and field tables instead of copying them; the template and
code plugin remain the worked examples.

`apps/shell/src/quality/guide.test.ts` enforces the mechanical parts:

- every relative link in `docs/guide/**` and `docs/walkthrough.md` resolves to a
  repository file or an existing heading;
- every backticked repository path (`apps/`, `packages/`, `examples/`, `docs/`,
  `schema/`) exists;
- every `npm run <script>` named in the guide exists in the root or workspace
  `package.json`;
- fenced JSON blocks marked `<!-- exo:manifest -->` validate with the shared
  schema and manifest rules.

The human criterion is a guide-only dry run: build a minimal editor from the
guide and template README without reading shell source, and record gaps fixed in
the guide.

Alternatives: typecheck every snippet (brittle extraction), duplicate the
contracts (drift), no checks (links and commands rot immediately).

### D6 - Demo workspace plus screenshot transcript, no video

`examples/demo-workspace/` declares the deployed code plugin and template
plugin in `exo.json`, with `hello.ts`, `data.json`, `notes.md`, `draft.md`,
`greeting.template.txt`, `plain.txt` and a `README.md` of expected observations.
It is separate from `examples/code-plugin-workspace/` so the existing
code-plugin-only example and its documentation stay valid.

`docs/walkthrough.md` is a numbered script with expected observations and
committed PNGs under `docs/media/walkthrough/`. Capture from the deployed URL on
the verification server with Chrome for Testing 131.0.6778.264 and an OPFS
handle mirroring the demo workspace (the layer 5-9 method), at 1280x800, with
the deployed commit, date and URL recorded in the walkthrough header. Screenshots
are re-captured when the release checklist runs; stale provenance fails the
checklist.

Alternatives: video (heavier binary, no easier to review), text only (no visual
evidence), local dev server (not an acceptance surface).

### D7 - Document the current release; do not bump versions

`docs/releases.md` defines the axes: shell SemVer (`@exo/shell`,
`SHELL_VERSION`, advertised in `shell/init`), protocol major (`exo: 1`), manifest
`schemaVersion: 1`, and SDK SemVer whose major equals the protocol major. The
template and code-plugin package versions are artifact versions, not
compatibility axes.

The current release is `0.1.0` / protocol `1` / schema `1` / SDK `1.1.0`.
`CHANGELOG.md` gets the matching first entry. No package version changes in this
layer: `engines.exo: ">=0.1.0"` manifests keep working, and a 1.0.0 shell release
is a separate decision governed by this plan. The contract examples that use
`^0.1.0` are updated to the shipped `>=0.1.0` form so a new author does not copy
a range that excludes a future shell.

The plan also defines the release checklist (local gate, deploy, deployed
verification, security/a11y/perf evidence, walkthrough refresh, changelog,
archive), the deprecation window (rest of the current major with an
`@deprecated` note and guide entry), and the breaking-change rule (new protocol
and SDK major, written upgrade note, no silent acceptance of the old major).

Alternatives: cut and tag 1.0.0 in this layer (changes compatibility for
`^0.1.0` authors and is not in the roadmap), leave versions undocumented
(authors cannot plan).

### D8 - Documentation consistency is part of done

The deployed evidence, README status, AGENTS commands and roadmap row are
updated in the same change. Stale statements found during the pass are fixed:
the README still calls the Stratofold track blocked on npm publication, while
P1-P3 are archived and verified. Contract cross-links point at
`docs/releases.md`, `docs/security-review.md`, `docs/accessibility.md`,
`docs/browser-support.md` and the guide without changing normative values.

## Risks / Trade-offs

- **Axe flags upstream workbench chrome that Exo must not fork** → scan
  Exo-owned surfaces directly; whole-app scans exclude the upstream root and
  document every excluded rule with an owner.
- **Theme token parsing breaks on a kit upgrade** → the test fails loudly and
  the upgrade updates the parser and the documented pairs; the values are never
  copied into a fixture.
- **Wall-clock budgets vary by machine** → named reference environment, warm-up,
  median of five, generous ceilings, manual release check instead of CI.
- **10k rows may exceed the longest-task budget** → batched rendering fallback;
  if still missed, record an accepted miss with owner or block the release.
- **Screenshots and guide commands go stale** → provenance header, guide test
  for paths/commands/links, and release-checklist re-capture.
- **Secret scan false positives** → narrow credential patterns, dist-only scan,
  documented allowlist; a test injects a marker to prove the scan fails.
- **Version communication drifts from code** → the existing version tests pin
  `SHELL_VERSION` to the package; the changelog test compares the newest entry
  with the current axes.

## Migration Plan

No data or protocol migration. Land the docs, tests and CI step on `main`; the
`verify` job must pass and the Pages deploy must contain the same shell plus the
existing child paths. Verify the release criteria against the deployed URL, then
sync the three deltas into `openspec/specs/` and archive the change. Rollback is
a revert of the change; no stored workspace, plugin or remote state is affected.

## Open Questions

None. Version bumps, tags and a published SDK remain outside this layer and are
governed by `docs/releases.md`.
