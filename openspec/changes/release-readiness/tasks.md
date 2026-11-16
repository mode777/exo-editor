# Tasks

## 1. Security review and artifact scan

- [x] 1.1 Write the control inventory in `docs/security-review.md`: one row per
  trust-boundary control (origin and source validation, consent-before-code,
  sandbox by origin, path containment, reserved paths, CSP, payload and size
  limits, consent fingerprint, shell-owned credentials, secret-free delivery)
  mapped to its contract requirement, enforcement point and existing test;
  verify every named test file and requirement ID exists and the table has no
  empty cell
- [x] 1.2 Mutation-check the protocol controls: temporarily weaken origin/source
  validation, consent-before-code and sandbox selection one at a time, run the
  mapped tests, confirm each fails, revert, and record the failing test name in
  the review; verify the working tree is clean after each revert
- [x] 1.3 Mutation-check the workspace and artifact controls: path containment,
  reserved paths, CSP, payload and size limits, consent fingerprint and
  shell-owned credentials; add a regression test where the mutation survives,
  and record the result in the review; verify each remaining check has at least
  one test that fails when it is removed
- [x] 1.4 Add `apps/shell/scripts/check-dist-secrets.mjs`, a root
  `check:dist-secrets` script and a test that injects a fake credential into a
  built asset; verify the scan passes on the real `apps/shell/dist`, fails on the
  injected asset, and is wired into CI after `deploy:copy-code`
- [ ] 1.5 Finalise the review with the dated findings table (no open finding
  above accepted, every accepted finding has rationale and owner) and link it
  from `README.md` and `docs/architecture.md`; verify the deployed artifact scan
  result and review date/commit are recorded

## 2. Accessibility

- [x] 2.1 Add `axe-core` as a shell development dependency and a `runAxe`
  helper; add scans for the explorer, document area, settings, consent,
  close-prompt, remote-connect and plugin-log surfaces; verify the new tests
  pass and every excluded upstream node is listed with its rule and rationale in
  `docs/accessibility.md`
- [x] 2.2 Add `apps/shell/src/components/useModalDialog.ts` and migrate
  `ConsentDialog`, `SettingsDialog`, `ClosePromptDialog` and
  `ConnectRemoteDialog` to it; verify tests cover initial focus, Tab and
  Shift+Tab cycling, Escape, and focus restoration to the invoking control
- [x] 2.3 Fix the accessibility gaps the scans and audit find in Exo-owned
  surfaces (tree state and keyboard behaviour, live-region announcements,
  visible focus, contrast); add the explorer tree-semantics and announcement
  regression tests plus a contrast test that parses the pinned dark and light
  token palettes; verify the contrast test fails when a documented pair is
  lowered below 4.5:1 or 3:1
- [ ] 2.4 Write `docs/accessibility.md` with scope, automated results, the
  manual keyboard-only and screen-reader smoke script, upstream exceptions and
  known limitations; verify the script against the deployed shell and record the
  date and result

## 3. Browser support matrix

- [x] 3.1 Write `docs/browser-support.md` with the Chromium, Firefox, Safari,
  remote-workspace and mobile entries, each marked supported, unsupported or
  unverified with browser version, date and evidence; verify every claimed
  entry cites a deployed-verification record and no unverified combination is
  described as supported
- [x] 3.2 Align the runtime unsupported states and the remote-connect offer with
  the matrix and add tests that fail when the matrix and behaviour disagree;
  verify the Firefox no-directory-picker state and the remote-connect path in
  the deployed shell match their matrix rows

## 4. Runtime performance budgets

- [x] 4.1 Add a structural explorer test with a 10,000-entry directory that
  asserts one `list` call and no per-entry `stat`, and that only expanded
  directories are listed; verify the test fails when an eager recursive listing
  or per-entry stat is introduced
- [x] 4.2 Write `docs/performance.md` with the budgets, reference environment,
  measurement procedure and result table; verify it names Chrome for Testing
  131.0.6778.264, the verification server, warm-up, five runs and median/maximum
  reporting, and links the CI bundle-budget check
- [ ] 4.3 Measure plugin frame startup, the 10k-entry listing, and 1 MiB open
  and save against the deployed shell on the reference environment and record
  the results; if a ceiling is exceeded, add batched row rendering or record an
  accepted miss with owner and follow-up; verify the final table has no
  unaccepted miss and the 10k longest task is within 1,000 ms

## 5. Plugin author guide

- [x] 5.1 Write `docs/guide/README.md`, `manifest.md`, `protocol.md`, `sdk.md`,
  `hosting.md`, `consent.md` and `testing.md`; each page links the owning
  contract instead of restating limits, error codes or field tables; verify a
  reviewer can follow the quickstart to the template without opening shell
  source
- [x] 5.2 Add `apps/shell/src/quality/guide.test.ts` covering relative links and
  headings, backticked repository paths, `npm run` script names and
  `<!-- exo:manifest -->` blocks validated with the real manifest validator;
  verify the test passes and fails when a link, path, script or manifest value is
  broken
- [ ] 5.3 Run the guide-only dry run: build a minimal editor from the guide and
  template README alone, record every gap, and fix the guide or template README;
  verify the dry-run plugin registers, reads, saves and disposes on the deployed
  shell using only documented steps

## 6. Demo workspace and walkthrough

- [x] 6.1 Add `examples/demo-workspace/` with `exo.json` declaring the deployed
  code and template plugins plus `hello.ts`, `data.json`, `notes.md`,
  `draft.md`, `greeting.template.txt`, `plain.txt` and a README of expected
  observations; verify the manifest validates with the real validator and each
  file selects the documented surface
- [ ] 6.2 Write `docs/walkthrough.md` with numbered steps and expected
  observations, then capture the committed PNGs under
  `docs/media/walkthrough/` from the deployed URL with the demo workspace on an
  OPFS handle; verify each screenshot's documented date/commit/URL matches the
  deployment and every step reproduces
- [x] 6.3 Link the demo workspace and walkthrough from `README.md`,
  `AGENTS.md`, `docs/guide/testing.md` and the roadmap; verify every link
  resolves and no local dev-server URL is presented as evidence

## 7. Release versioning and communication

- [x] 7.1 Write `docs/releases.md` with the version axes, release checklist,
  changelog policy, deprecation timeline, breaking-change upgrade-note rule and
  current release record; verify every axis value matches
  `apps/shell/package.json`, `SHELL_VERSION`, the protocol constant, the schema
  and `@exo/plugin-sdk`
- [x] 7.2 Add `CHANGELOG.md` with the current release entry and a test that
  compares the newest entry with the current shell, protocol, schema and SDK
  versions; verify the test passes and fails when one version is changed alone
- [x] 7.3 Cross-link `docs/releases.md` from the versioning sections of the
  protocol, manifest and SDK contracts, and update the manifest example to the
  shipped `>=0.1.0` engine range; verify no normative value or requirement text
  changed and the links resolve

## 8. Integration, deployment and evidence

- [x] 8.1 Update `README.md` (layers 0-10, document table, guide/demo/walkthrough
  links, Stratofold archived status), `AGENTS.md` (current state, commands,
  demo workspace) and `docs/architecture.md` (release evidence links); verify
  every documented command exists and no stale "blocked" or pre-layer-10 claim
  remains
- [x] 8.2 Run the full local gate: `npm ci`, lint, format check, typecheck,
  tests, build, bundle budget, CSP, custom elements, no-SDK, no-Monaco,
  `check:dist-secrets`, template build/copy and code-plugin build/copy; verify
  every command passes and the bundle stays within the committed budget
- [ ] 8.3 Deploy by pushing `main`; verify the CI `verify` job is green and the
  Pages artifact contains the shell plus the template and code-plugin child
  paths
- [ ] 8.4 Verify the layer-10 exit criteria against the deployed shell: rerun
  the security scan, the accessibility manual script, the browser matrix states,
  the performance measurements, the demo workspace and the walkthrough; record
  every result, date and deployed commit
- [ ] 8.5 Update the `ROADMAP.md` layer-10 status, exit criteria and evidence
  from 8.4, then run `openspec validate --all` and verify the change, the three
  deltas and every existing spec validate

## Workflow follow-up

- Archive the change after the deployed evidence and the project's review
  requirements are satisfied.
- Sync the `plugin-authoring`, `editor-shell` and `workspace-access` deltas into
  `openspec/specs/`, then re-run `openspec validate --all`.
- Confirm the archive leaves the active changes list empty and the roadmap row
  points at the archived change.
