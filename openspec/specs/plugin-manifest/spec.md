# plugin-manifest Specification

## Purpose
Defines how a workspace declares plugins, what a plugin is allowed to claim, how
its entry page is bound to its manifest, and how user consent is captured and
invalidated.

## Requirements

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

The shell SHALL fetch each manifest with credentials omitted, a 5-second timeout,
a 256 KiB response cap and a JSON-compatible `Content-Type`, SHALL validate the
entire document against the shared v1 manifest schema before any UI beyond a
loading row or any frame, including rejecting unknown fields, SHALL reject
`contributes.configuration` until layer 7 activates it, and SHALL treat
validation as all-or-nothing.

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
- **THEN** validation fails with `invalid-manifest` and the plugin is not loaded

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

### Requirement: Entry pages are bound to the plugin root

The shell SHALL require `runtime.entry` and every
`contributes.fileEditors[].entry` to be a relative HTML path with no query,
fragment or `..` segment, SHALL resolve each entry against the final manifest URL,
SHALL require each resolved entry to share the manifest's origin, and SHALL
confine every page the plugin loads to the directory tree rooted at the resolved
controller entry (siblings and descendants allowed, parents and unrelated
directories rejected).

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

### Requirement: Same-origin plugin entries

The entry origin MAY equal the shell origin. When it does, the shell SHALL apply
the stricter sandbox (`allow-scripts` only) and SHALL state in consent that the
plugin runs without storage access and cannot be isolated by origin.

#### Scenario: First-party entry is sandboxed

- **WHEN** `runtime.entry` resolves to the shell origin
- **THEN** the registration frame is mounted without `allow-same-origin` and the
  consent prompt explains the consequence

### Requirement: Editor selection and priority

When more than one registered file editor matches an open document, the shell
SHALL choose the highest `priority`, then the earliest registration, SHALL keep
the other matches available through "Open with...", and SHALL apply the same
resolution to every document regardless of whether the editor is first-party.

#### Scenario: Highest priority wins

- **WHEN** two plugins register matching globs with priorities `10` and `0`
- **THEN** the `10` editor opens the document and the other remains available
  through "Open with..."

#### Scenario: Equal priority falls back to registration order

- **WHEN** two matching registrations share a priority
- **THEN** the earlier registration is selected and the choice is deterministic

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
id, together with a fingerprint computed over exactly the plugin id, entry
origin, plugin root path, sorted permissions, and sorted editor globs and
priorities. A different fingerprint SHALL be treated as consent not granted, and
a manifest field that changes plugin behaviour SHALL be added to the fingerprint
input in the same change that introduces it.

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
