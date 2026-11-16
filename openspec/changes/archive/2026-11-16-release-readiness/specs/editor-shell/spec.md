# Spec Delta

## ADDED Requirements

### Requirement: Accessible shell surfaces

Exo-owned shell surfaces SHALL expose programmatic roles, names and states, be
operable by keyboard, keep visible focus, announce status and errors through live
regions, and meet WCAG 2.2 AA text contrast in both themes. Modal dialogs SHALL
trap focus, close on Escape and restore focus to the invoking control. Upstream
workbench chrome exceptions SHALL be documented with rationale.

#### Scenario: Automated scan of Exo-owned surfaces

- **WHEN** the explorer, document area, settings, consent, close-prompt,
  remote-connect and plugin-log surfaces are rendered and scanned with an
  accessibility rule engine
- **THEN** no violation is reported for an Exo-owned node, and any excluded
  upstream workbench node is listed with its rule, rationale and owner in
  `docs/accessibility.md`

#### Scenario: Dialog focus lifecycle

- **WHEN** a dialog is opened from the keyboard
- **THEN** focus moves to its initial control, Tab and Shift+Tab stay inside the
  dialog, Escape closes it and focus returns to the control that opened it

#### Scenario: Explorer tree semantics

- **WHEN** the explorer renders a workspace
- **THEN** it exposes a tree with treeitem rows carrying level, expanded and
  selected state, exactly one row in the tab order, and the documented arrow,
  Enter, F2 and Delete keys keep focus on a valid row

#### Scenario: No keyboard trap outside a dialog

- **WHEN** the user navigates every Exo-owned surface by keyboard alone
- **THEN** focus reaches each interactive control and can leave every region that
  is not an open modal dialog

#### Scenario: Status and errors are announced

- **WHEN** a save fails, a workspace becomes read-only, or consent is denied
- **THEN** the surface announces the message once through a live region and does
  not duplicate it as a second alert or status

#### Scenario: Contrast in both themes

- **WHEN** Exo-owned text, disabled text and focus indicators are measured
  against their adjacent background in the light and dark themes
- **THEN** text meets at least 4.5:1, and focus indicators and large text meet at
  least 3:1

### Requirement: Runtime performance budgets

The project SHALL record and re-measure budgets for plugin frame startup, a
10k-entry directory listing and a 1 MiB file open/save against the deployed
shell on a named reference environment, SHALL keep explorer listing lazy with no
per-entry stat, and SHALL not declare a release ready while a budget is unmet
unless the miss is accepted in writing.

#### Scenario: Budgets and procedure are recorded

- **WHEN** `docs/performance.md` is inspected
- **THEN** it lists each budget, the reference browser and hardware, the
  measurement procedure, the measured result, and the date and deployed commit

#### Scenario: Large directory stays bounded

- **WHEN** a directory containing 10,000 entries is expanded
- **THEN** the explorer issues one directory listing and no per-entry stat, and
  the listing and render complete within the recorded budget

#### Scenario: A 1 MiB file round-trips within budget

- **WHEN** a 1 MiB text file is opened, edited and saved in the shell text
  surface and in the reference code plugin
- **THEN** the exact bytes round-trip and each open and save completes within the
  recorded budget

#### Scenario: Plugin frame startup within budget

- **WHEN** a matching file is opened and the reference code plugin mounts
- **THEN** the usable editor is visible within the recorded startup budget

#### Scenario: A budget miss is explicit

- **WHEN** a measured result exceeds its budget
- **THEN** the release is blocked until the regression is fixed or the miss is
  accepted in `docs/performance.md` with a rationale and follow-up owner

#### Scenario: Bundle budget stays enforced

- **WHEN** the verification pipeline runs
- **THEN** the committed JavaScript and CSS bundle budgets are still measured and
  fail the pipeline on regression, independently of the manual runtime budgets

### Requirement: Security review record

The project SHALL maintain a security review that maps each trust-boundary
control to its contract requirement, enforcement point and regression test,
records findings as resolved or accepted with rationale, and is updated in the
same change as any security-relevant behaviour. The deployed artifact SHALL be
scanned for credentials.

#### Scenario: Every control is mapped

- **WHEN** `docs/security-review.md` is read
- **THEN** it maps origin and source validation, consent-before-code, sandbox
  selection, path containment, reserved paths, CSP, payload and size limits,
  consent fingerprint, shell-owned credentials and secret-free delivery to a
  requirement, an enforcement point and at least one named test

#### Scenario: Removing a check fails a test

- **WHEN** a mapped check is removed or weakened for a mutation check
- **THEN** at least one named regression test fails, and the review records that
  result

#### Scenario: Findings block release

- **WHEN** the review contains an open finding
- **THEN** the release is blocked; an accepted finding names its rationale,
  owner, date and follow-up, and no finding above accepted severity remains open

#### Scenario: Deployed artifact has no credentials

- **WHEN** the built site is scanned for credential patterns and secret values
- **THEN** the scan finds none, fails the pipeline when a known pattern is
  injected into a built asset, and is recorded in the security review

#### Scenario: Review matches the release

- **WHEN** a release is prepared
- **THEN** the review's date and deployed commit match the release evidence
