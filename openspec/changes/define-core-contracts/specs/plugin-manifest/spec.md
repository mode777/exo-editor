# Spec Delta

## Purpose

Defines how a workspace declares plugins, what a plugin is allowed to claim, how
its entry page is bound to its manifest, and how user consent is captured and
invalidated.

## ADDED Requirements

### Requirement: Workspace plugin declaration

The shell SHALL read plugin declarations from `exo.json` at the workspace root
with a `schemaVersion` of `1` and a `plugins` array of at most 50 entries, each
carrying an absolute `https` manifest URL (or `http://localhost` in development)
with no credentials and no fragment, and an optional `enabled` flag defaulting to
`true`.

#### Scenario: Unknown fields are rejected

- **WHEN** `exo.json` contains an unknown top-level or plugin-entry field
- **THEN** validation fails for that entry with a stable error code and the field is not ignored silently

#### Scenario: Missing file means no plugins

- **WHEN** the workspace has no `exo.json`
- **THEN** the shell reports zero plugins and opens the workspace without an error

#### Scenario: Malformed file disables loading

- **WHEN** `exo.json` is not valid JSON or fails validation
- **THEN** no plugin is loaded, the workspace remains usable, and the problem is shown with the file path and the failing entry

#### Scenario: Entry limit

- **WHEN** `exo.json` declares more than 50 plugins
- **THEN** the shell reports the limit and loads none of the excess entries rather than truncating silently

#### Scenario: Duplicate manifests

- **WHEN** two entries name the same manifest URL
- **THEN** both are reported as duplicates and neither is loaded

#### Scenario: Live add and remove

- **WHEN** an enabled entry is added to or removed from `exo.json` while the workspace is ready
- **THEN** the added plugin initializes immediately and the removed plugin is torn down immediately

### Requirement: Manifest validation

The shell SHALL fetch each manifest with credentials omitted, a 5-second timeout
and a 256 KiB response cap, SHALL validate the entire document against the v1
manifest schema before any UI beyond a loading row or any frame, and SHALL treat
validation as all-or-nothing.

#### Scenario: Required identity fields

- **WHEN** a manifest omits `id`, `name`, `version`, `publisher.name`,
  `engines.exo`, `runtime.entry` or `permissions`
- **THEN** validation fails with `invalid-manifest` and the missing field is named

#### Scenario: Permission vocabulary

- **WHEN** a manifest lists a permission outside `workspace:read`,
  `workspace:write` or `events:subscribe`, or lists duplicates
- **THEN** validation fails instead of granting a subset

#### Scenario: Glob vocabulary

- **WHEN** a `fileEditors` glob contains negation, a regex construct, a leading
  slash, `..` or NUL
- **THEN** validation rejects that contribution with `invalid-glob`

#### Scenario: Editor entry is required and relative

- **WHEN** a `fileEditors` contribution omits `entry`, uses an absolute URL or
  contains a fragment or query
- **THEN** validation rejects that contribution with `invalid-manifest` and the
  contribution is not registered

#### Scenario: Transport failures

- **WHEN** the manifest request times out, is blocked by CORS, returns a
  non-success status or exceeds the size cap
- **THEN** the plugin is reported with `timeout`, `cors`, `http-status` or `too-large` and no frame is created

#### Scenario: Redirect origin

- **WHEN** the manifest request is redirected
- **THEN** the final response URL defines the manifest origin used for consent and entry containment

### Requirement: Entry pages are bound to the plugin root

The shell SHALL resolve `runtime.entry` and every
`contributes.fileEditors[].entry` against the final manifest URL, SHALL require
each resolved entry to share the manifest's origin, and SHALL confine every page
the plugin loads to the directory tree rooted at the resolved controller entry
(siblings and descendants allowed, parents and unrelated directories rejected).
The entry origin MAY equal the shell origin; when it does, the shell SHALL apply
the stricter sandbox and state that in consent.

#### Scenario: Cross-origin editor page is rejected

- **WHEN** a manifest served from `https://plugins.example.com` declares an editor
  entry on `https://cdn.example.net/editor.html`
- **THEN** validation fails with `unsupported-origin` for that contribution and no frame is mounted

#### Scenario: Cross-origin controller is rejected

- **WHEN** `runtime.entry` resolves to a host other than the manifest's final host
- **THEN** validation fails with `unsupported-origin` and no registration frame is created

#### Scenario: Parent directory escape is rejected

- **WHEN** `runtime.entry` is `plugin.html` and a contribution or registration points at `../shared/editor.html`
- **THEN** the page is rejected before the browser receives the URL

#### Scenario: Sibling and child pages are allowed

- **WHEN** `runtime.entry` is `plugin.html` and a page resolves to `other.html` or `editors/code.html`
- **THEN** the page is accepted without a new consent prompt

#### Scenario: Same-origin-with-shell plugin is allowed

- **WHEN** a manifest is served from the shell's own origin
- **THEN** it is accepted, flagged in consent as same-origin, and mounted with `allow-scripts` only

#### Scenario: Insecure transport

- **WHEN** a manifest or entry uses `http` on a host other than `localhost`
- **THEN** validation fails and the error names the insecure URL

### Requirement: Consent gates code loading

The shell SHALL require explicit user approval before mounting any plugin frame,
including first-party plugins served from the shell origin, and SHALL treat a
missing or stale approval as no approval.

#### Scenario: No consent, no frame

- **WHEN** the user has not approved a plugin
- **THEN** no iframe, script or network request to the entry origin is made and the plugin is listed as awaiting consent

#### Scenario: Deny

- **WHEN** the user denies consent
- **THEN** the plugin is not loaded, the denial is remembered for the session, and the user is asked again on the next workspace load

#### Scenario: First-party plugin still prompts

- **WHEN** a plugin is served from the shell origin
- **THEN** the consent prompt still appears and states that the plugin runs without storage access and cannot be isolated by origin

### Requirement: Consent prompt names the origin and the approved surface

The approval prompt SHALL display the plugin's name, id, version and publisher,
the exact manifest origin including scheme, host and port, the controller entry
URL, the plugin root, each declared editor entry, the requested permissions in
plain language, the declared globs with labels, whether the plugin can write to
the workspace, and whether it shares the shell origin.

#### Scenario: Exact origin is shown

- **WHEN** the consent prompt is rendered
- **THEN** it shows the origin as text and does not replace it with a logo, a display name or a registrable-domain label

#### Scenario: Approved root is visible

- **WHEN** the consent prompt is rendered for `https://plugins.example.com/monaco/plugin.html`
- **THEN** it shows the plugin root `https://plugins.example.com/monaco/` so the user can see which directory the approval covers

### Requirement: Consent fingerprint

The shell SHALL persist consent machine-wide, keyed by manifest origin and plugin
id, together with a fingerprint computed over the plugin id, entry origin, plugin
root path, sorted permissions, and sorted editor globs and priorities. A
different fingerprint SHALL be treated as consent not granted.

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

### Requirement: Manifest schema and engine versioning

The shell SHALL accept exactly manifest `schemaVersion` `1`, SHALL require
`engines.exo` to include the shell version, and SHALL report incompatible plugins
instead of attempting to load them. The manifest schema version SHALL be
independent of the plugin protocol major version and the shell version.

#### Scenario: Unknown schema version

- **WHEN** a manifest declares `schemaVersion: 2`
- **THEN** it is reported as `unsupported-version` and is not partially parsed

#### Scenario: Engine range excludes the shell

- **WHEN** `engines.exo` does not include the running shell version
- **THEN** the plugin is listed as incompatible with both versions shown and no frame is mounted
