# Spec Delta

## ADDED Requirements

### Requirement: Plugin identity and duplicate identities

The shell SHALL derive plugin identity from the final manifest origin and the
manifest `id`. Two entries that resolve to the same identity in one workspace
SHALL NOT both load: the earlier declaration wins, the later is reported as
`duplicate-identity` and mounts no frame. Consent and settings SHALL key on that
identity.

#### Scenario: Duplicate identity in one workspace

- **WHEN** two enabled manifests on the same origin declare the same plugin id
- **THEN** the earlier declaration loads, the later entry reports `duplicate-identity` and neither a consent prompt nor a frame is created for it

#### Scenario: Same id on different origins

- **WHEN** two manifests on different origins declare the same plugin id
- **THEN** they are treated as distinct plugins with distinct consent records

#### Scenario: Identity follows the final origin

- **WHEN** a manifest request is redirected to another origin
- **THEN** the identity and consent key use the final response origin, not the origin in `exo.json`

#### Scenario: Duplicate identity is stable after refresh

- **WHEN** the declaration is refreshed and the same duplicate pair is still present
- **THEN** the same earlier entry loads and the same later entry remains failed, without remounting frames

### Requirement: Unique editor globs

The shell SHALL reject a manifest that declares the same `glob` more than once in
`contributes.fileEditors`, so a registered glob maps to exactly one priority and
one default label.

#### Scenario: Duplicate glob declaration

- **WHEN** a manifest lists two `fileEditors` contributions with the same `glob`
- **THEN** validation fails with `invalid-manifest` and no contribution is registered

#### Scenario: Repeated entry with distinct globs

- **WHEN** two contributions use the same `entry` page with different globs
- **THEN** both are valid and may register independently

### Requirement: Fetch rejection classification

When a cross-origin manifest request rejects before a response, the shell SHALL
report `cors` with a message naming the manifest origin and stating that a
network failure is possible, because browsers do not expose the difference. A
same-origin rejection SHALL be reported as `network`, a timeout as `timeout` and
a non-success response as `http-status`.

#### Scenario: Cross-origin rejection

- **WHEN** a manifest on a different origin rejects with a fetch `TypeError`
- **THEN** the plugin reports `cors`, names the origin and does not claim that CORS was the only possible cause

#### Scenario: Same-origin rejection

- **WHEN** a first-party manifest on the shell origin rejects with a fetch `TypeError`
- **THEN** the plugin reports `network`

#### Scenario: Timeout is not CORS

- **WHEN** the manifest request exceeds the five-second limit
- **THEN** the plugin reports `timeout` and no consent prompt is shown

#### Scenario: HTTP status is not CORS

- **WHEN** the manifest responds with a non-success status
- **THEN** the plugin reports `http-status` with the status code

## MODIFIED Requirements

### Requirement: Editor selection and priority

When more than one registered file editor matches an open document, the shell
SHALL choose the highest `priority`, then the earliest registration, SHALL keep
the other matches available through "Open with...", and SHALL apply the same
resolution to every document regardless of whether the editor is first-party.
The earliest registration is the earlier enabled entry in `exo.json`, then the
earlier registration message within that plugin, so selection does not depend on
fetch or handshake completion order.

#### Scenario: Highest priority wins

- **WHEN** two plugins register matching globs with priorities `10` and `0`
- **THEN** the `10` editor opens the document and the other remains available
  through "Open with..."

#### Scenario: Equal priority falls back to registration order

- **WHEN** two matching registrations share a priority
- **THEN** the earlier declaration is selected and the choice is deterministic

#### Scenario: Completion order does not change the choice

- **WHEN** the later declaration completes its registration before the earlier one
- **THEN** the earlier declaration is still selected when both share a priority
