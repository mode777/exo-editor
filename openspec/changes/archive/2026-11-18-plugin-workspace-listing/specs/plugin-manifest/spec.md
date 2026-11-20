# Spec Delta

## ADDED Requirements

### Requirement: Workspace listing consent

The shell SHALL describe `workspace:list` in the consent prompt as permission to list folder contents and file names, SHALL include it in the consent fingerprint through the sorted permissions input, and SHALL require fresh consent when an already-approved reader adds it.

#### Scenario: Consent names listing

- **WHEN** a manifest that declares `workspace:list` is shown for consent
- **THEN** the prompt explains that the plugin can list folder contents and file names in the workspace

#### Scenario: Adding listing re-prompts

- **WHEN** a plugin that previously declared only `workspace:read` adds `workspace:list`
- **THEN** its fingerprint changes and the shell requests fresh consent before loading the plugin

#### Scenario: Existing reader keeps consent

- **WHEN** a plugin declares `workspace:read` but not `workspace:list`
- **THEN** its fingerprint is unchanged and its stored consent remains valid

#### Scenario: Engine gate for older shells

- **WHEN** a manifest uses `workspace:list` and its `engines.exo` range excludes a shell that does not support listing
- **THEN** that shell reports `incompatible-engine` before validating the permission vocabulary

## MODIFIED Requirements

### Requirement: Manifest validation

The shell SHALL fetch each manifest with credentials omitted, a 5-second timeout,
a 256 KiB response cap and a JSON-compatible `Content-Type`, SHALL validate the
entire document against the shared v1 manifest schema before any UI beyond a
loading row or any frame, including rejecting unknown fields, SHALL validate
`contributes.configuration` against the configuration rules in this spec, and
SHALL treat validation as all-or-nothing.

#### Scenario: Required identity fields

- **WHEN** a manifest omits `id`, `name`, `version`, `publisher.name`,
  `engines.exo`, `runtime.entry` or `permissions`
- **THEN** validation fails with `invalid-manifest` and the missing field is named

#### Scenario: Permission vocabulary

- **WHEN** a manifest lists a permission outside `workspace:read`,
  `workspace:write`, `workspace:list` or `events:subscribe`, or lists duplicates
- **THEN** validation fails instead of granting a subset

#### Scenario: Write implies read

- **WHEN** a manifest grants `workspace:write` without `workspace:read`
- **THEN** validation fails rather than silently adding or dropping a permission

#### Scenario: Listing requires read

- **WHEN** a manifest grants `workspace:list` without `workspace:read`
- **THEN** validation fails with `invalid-manifest` and no listing permission is granted

#### Scenario: Glob vocabulary

- **WHEN** a `fileEditors` glob contains negation, a regex construct, a leading
  slash, `..` or NUL, or is longer than 200 characters
- **THEN** validation rejects that contribution with `invalid-glob`

#### Scenario: Contribution limit

- **WHEN** a manifest declares more than 20 `fileEditors` contributions
- **THEN** validation fails with `invalid-manifest` and none of the excess
  contributions are registered

#### Scenario: Editor entry is required and relative

- **WHEN** a `fileEditors` contribution omits `entry`, uses an absolute URL,
  contains a fragment, a query or a `..` segment, or does not name an HTML page
- **THEN** validation rejects that contribution with `invalid-manifest` and the
  contribution is not registered

#### Scenario: Unknown manifest fields

- **WHEN** a manifest contains an unknown field at any level
- **THEN** validation fails with `invalid-manifest` and no field is ignored or
  preserved as trusted data

#### Scenario: Reserved configuration contribution

- **WHEN** a v1 manifest declares `contributes.configuration`
- **THEN** validation accepts the contribution and exposes its settings instead
  of rejecting it as reserved

#### Scenario: Valid configuration contribution

- **WHEN** a v1 manifest declares a valid `contributes.configuration`
- **THEN** validation succeeds and the declared settings are exposed

#### Scenario: Invalid configuration contribution

- **WHEN** a v1 manifest declares `contributes.configuration` that violates the
  shape, type, default, enum or scope rules
- **THEN** validation fails with `invalid-manifest`, names the failing field and
  the plugin is not loaded

#### Scenario: Content type is not JSON

- **WHEN** the manifest response omits `Content-Type` or serves a non-JSON media
  type
- **THEN** the plugin is reported with `invalid-manifest` before the body is parsed

#### Scenario: Transport failures

- **WHEN** the manifest request fails at the network layer, times out, is blocked
  by CORS, returns a non-success status or exceeds the size cap
- **THEN** the plugin is reported with `network`, `timeout`, `cors`,
  `http-status`, `too-large` or `invalid-json` as applicable and no frame is
  created

#### Scenario: Redirect origin

- **WHEN** the manifest request is redirected
- **THEN** the final response URL defines the manifest origin used for consent and entry containment
