# Spec Delta

## ADDED Requirements

### Requirement: Documented browser support matrix

The project SHALL publish and maintain a browser support matrix that classifies
each browser and provider combination as supported, unsupported or unverified,
with verification evidence, and the shell's runtime unsupported states SHALL
match it. A change that adds or verifies a browser or provider combination SHALL
update the matrix.

#### Scenario: Matrix classifies every combination

- **WHEN** `docs/browser-support.md` is inspected
- **THEN** it classifies Chromium desktop folder workspaces as supported,
  Firefox and Safari folder workspaces as unsupported with an explicit runtime
  state, remote workspaces per the verified evidence, and mobile browsers as out
  of scope for v1

#### Scenario: Runtime matches the matrix

- **WHEN** a browser without a directory picker opens the deployed shell
- **THEN** the unsupported state matches the matrix entry, offers the remote
  connect path when the matrix marks remote workspaces supported there, and does
  not fabricate a folder workspace

#### Scenario: Evidence is cited

- **WHEN** a matrix entry is read
- **THEN** it names the browser version, date and verification evidence, or is
  labelled unverified instead of claiming support

#### Scenario: Unverified is not support

- **WHEN** a browser and provider combination has no verification evidence
- **THEN** the matrix labels it unverified and the documentation does not claim
  that combination works

#### Scenario: Provider change updates the matrix

- **WHEN** a change adds a provider or verifies a new browser
- **THEN** the same change updates the matrix and the runtime states it affects
