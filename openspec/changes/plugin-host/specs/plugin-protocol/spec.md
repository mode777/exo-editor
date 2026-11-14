# Spec Delta

## ADDED Requirements

### Requirement: Registration contribution details

The shell SHALL accept `plugin/register` contributions shaped as
`{ glob, entry, label? }`, SHALL take the priority from the matching manifest
contribution, SHALL default a missing label to that contribution's label, SHALL
reject a label outside 1-40 characters, and SHALL deduplicate identical glob and
entry pairs into one registry contribution. `shell/register-ack` SHALL carry
accepted glob strings and rejected entries with an index and a stable reason.

#### Scenario: Label defaults to the manifest label

- **WHEN** a registration omits `label` for a glob declared with label `Code`
- **THEN** the registered editor is labelled `Code`

#### Scenario: Explicit label is accepted

- **WHEN** a registration supplies a label of 1 to 40 characters
- **THEN** that label is used for the registered editor

#### Scenario: Invalid label is rejected

- **WHEN** a registration supplies a label longer than 40 characters or an empty label
- **THEN** that contribution is rejected with reason `invalid-contribution` and the other valid contributions still activate

#### Scenario: Priority comes from the manifest

- **WHEN** a manifest declares a glob with priority `7` and the registration omits any priority
- **THEN** the registered editor is stored with priority `7`

#### Scenario: Acknowledgement lists accepted globs

- **WHEN** a plugin completes registration with two accepted contributions
- **THEN** `shell/register-ack` contains both glob strings in `accepted`

#### Scenario: Acknowledgement lists rejected entries

- **WHEN** a registration includes an undeclared glob and an entry outside the plugin root
- **THEN** `rejected` contains an entry for each with its index and the reason `not-declared` or `permission-denied`

#### Scenario: Identical registration is deduplicated

- **WHEN** a plugin registers the same glob and entry pair twice before completing
- **THEN** exactly one registry contribution is created

### Requirement: Shell message target origin

The shell SHALL address `shell/*` messages to the plugin's exact origin for a
cross-origin frame and SHALL use `*` only for a same-origin frame whose sandbox
gives it an opaque origin, where no origin can be named. The shell SHALL never
use `*` for a cross-origin frame.

#### Scenario: Cross-origin target

- **WHEN** the shell sends `shell/init` to a plugin served from `https://plugins.example.com`
- **THEN** `postMessage` uses `https://plugins.example.com` as its target origin

#### Scenario: Opaque same-origin target

- **WHEN** the shell sends `shell/init` to a first-party plugin running with `allow-scripts` only
- **THEN** `postMessage` uses `*` because the frame has no nameable origin

#### Scenario: Wildcard is not used cross-origin

- **WHEN** a frame has a non-opaque cross-origin identity
- **THEN** no shell message is posted with `*`

#### Scenario: Init still carries no content

- **WHEN** the shell posts to an opaque same-origin frame
- **THEN** `shell/init` contains only the metadata the contract allows and no file content
