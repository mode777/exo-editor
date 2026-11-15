# Spec Delta

## ADDED Requirements

### Requirement: Contributed configuration shape

The shell SHALL accept `contributes.configuration` as an object with a required
`properties` object of at most 50 settings, each keyed by a stable name of at most
64 characters matching the manifest's setting-key form. Unknown fields at the
configuration or setting level SHALL make the manifest invalid, and omitting the
contribution SHALL mean no settings.

#### Scenario: Valid configuration is accepted

- **WHEN** a manifest declares `configuration.properties` with supported settings
- **THEN** validation succeeds and the settings are exposed to the shell

#### Scenario: Unknown configuration field

- **WHEN** `configuration` contains a field other than `properties`, or a setting
  contains an unknown field
- **THEN** validation fails with `invalid-manifest` naming the field and no frame
  is mounted

#### Scenario: Setting limit

- **WHEN** a manifest declares more than 50 settings
- **THEN** validation fails with `invalid-manifest` and no settings are exposed

#### Scenario: Invalid setting key

- **WHEN** a setting key is empty, longer than 64 characters or uses characters
  outside the declared setting-key form
- **THEN** validation fails with `invalid-manifest` and names the key

### Requirement: Configuration setting types and defaults

Each declared setting SHALL have `type` (`boolean`, `string` or `number`), a
`default` matching that type, an optional non-empty `enum` of at most 50 unique
values of the same type with the default among them, an optional 1-500 character
`description`, and an optional `scope` that MUST be `workspace`; omitting `scope`
SHALL mean `workspace`.

#### Scenario: Supported types and defaults

- **WHEN** a setting declares `boolean`, `string` or `number` with a default of
  the same type
- **THEN** validation accepts it and the default is available as the initial value

#### Scenario: Default type mismatch

- **WHEN** a setting's default does not match its declared type
- **THEN** validation fails with `invalid-manifest` naming the setting

#### Scenario: Invalid enum

- **WHEN** an enum is empty, has more than 50 or duplicate values, mixes types,
  does not match the setting type, or does not contain the default
- **THEN** validation fails with `invalid-manifest` naming the setting

#### Scenario: Unsupported scope

- **WHEN** a setting declares a scope other than `workspace`
- **THEN** validation fails rather than silently treating it as workspace

#### Scenario: Description limit

- **WHEN** a setting description is empty or longer than 500 characters
- **THEN** validation fails with `invalid-manifest` naming the setting

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
  `workspace:write` or `events:subscribe`, or lists duplicates
- **THEN** validation fails instead of granting a subset

#### Scenario: Write implies read

- **WHEN** a manifest grants `workspace:write` without `workspace:read`
- **THEN** validation fails rather than silently adding or dropping a permission

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

### Requirement: Consent fingerprint

The shell SHALL persist consent machine-wide, keyed by manifest origin and plugin
id, together with a fingerprint computed over exactly the plugin id, entry
origin, plugin root path, sorted permissions, and sorted editor globs and
priorities. A different fingerprint SHALL be treated as consent not granted, and
a manifest field that changes plugin behaviour SHALL be added to the fingerprint
input in the same change that introduces it. `contributes.configuration` declares
user-editable shell state, does not grant capability, and SHALL NOT change the
fingerprint.

#### Scenario: Cosmetic release keeps consent

- **WHEN** a new manifest version changes only name, description, icon, homepage or version
- **THEN** the stored consent remains valid and the user is not prompted

#### Scenario: Widers re-prompt

- **WHEN** a manifest adds a permission, adds or widens a glob, changes an existing priority, moves its entry origin or moves the plugin root
- **THEN** the fingerprint changes and the plugin requires fresh consent before any frame is mounted

#### Scenario: Page added inside the root keeps consent

- **WHEN** a new release adds or renames an editor page inside the already-approved plugin root
- **THEN** the fingerprint is unchanged and the page loads without a new prompt

#### Scenario: Consent storage

- **WHEN** consent is granted
- **THEN** a record with origin, plugin id, manifest URL, version, fingerprint and grant time is written to the versioned `localStorage` key, and a corrupt store is discarded rather than repaired

#### Scenario: Revocation tears down

- **WHEN** the user revokes consent for a loaded plugin
- **THEN** its frames are disposed, its registrations are removed, and open documents handled by it fall back to the shell renderer

#### Scenario: Configuration declaration keeps consent

- **WHEN** a new manifest version adds, removes or changes its
  `contributes.configuration` declaration without changing its origin, root,
  permissions or editor globs
- **THEN** the fingerprint is unchanged and the user is not prompted again
