# plugin-manifest Specification

## Purpose
Defines how a workspace declares plugins, what a plugin is allowed to claim, how
its entry page is bound to its manifest, and how user consent is captured and
invalidated.

## Requirements

### Requirement: Workspace plugin declaration

The shell SHALL read plugin declarations from `exo.json` at the workspace root
with a `schemaVersion` of `1` and a `plugins` array of at most 50 entries, each
carrying an absolute `https` manifest URL (or `http://localhost`) with no
credentials or fragment and an optional `enabled` flag defaulting to `true`. Any
validation failure SHALL yield zero usable entries and a stable per-entry error
with its index and field; a missing file SHALL mean zero plugins, not an error.

#### Scenario: Unknown fields are rejected

- **WHEN** `exo.json` contains an unknown top-level or plugin-entry field
- **THEN** validation fails with `invalid-config`, the failing field is named, and no entry is usable

#### Scenario: Missing file means no plugins

- **WHEN** the workspace has no `exo.json`
- **THEN** the shell reports zero plugins and opens the workspace without an error

#### Scenario: Malformed file disables loading

- **WHEN** `exo.json` is not valid JSON or fails validation
- **THEN** zero usable entries remain, the workspace stays usable, and the problem is shown with the file path and each failing entry

#### Scenario: Partial failure is all-or-nothing

- **WHEN** `exo.json` contains one valid entry and one invalid entry
- **THEN** the invalid entry is reported with `invalid-config` and neither entry is usable

#### Scenario: Entry limit

- **WHEN** `exo.json` declares more than 50 plugins
- **THEN** the shell reports `too-many-plugins` with zero usable entries rather than truncating the list

#### Scenario: Duplicate manifests

- **WHEN** two entries name the same manifest URL
- **THEN** both are reported as `duplicate-manifest` and no entry is usable

#### Scenario: Invalid manifest URL

- **WHEN** an entry's manifest URL is relative, uses `http` on a host other than
  `localhost`, contains credentials or contains a fragment
- **THEN** that entry is reported with `invalid-config` and no entry is usable

#### Scenario: Invalid enabled value

- **WHEN** an entry's `enabled` value is present but not a boolean
- **THEN** that entry is reported with `invalid-config` and no entry is usable

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

### Requirement: Configuration loading and refresh

The shell SHALL load the declaration through the shell side of the workspace
session when a workspace becomes ready, SHALL update it after every shell write
and on window focus or visibility, SHALL skip content whose stat version is
unchanged, SHALL cap the file at 256 KiB, and SHALL reset configuration state on
a workspace switch so a late result cannot update the next workspace.

#### Scenario: Load on workspace ready

- **WHEN** a workspace becomes ready
- **THEN** the shell reads `/exo.json` once through the shell side of the session and publishes the resulting configuration state

#### Scenario: Focus refresh picks up an external edit

- **WHEN** `exo.json` changes on disk and the window regains focus or becomes visible
- **THEN** the shell reads the new content and replaces the previous entries

#### Scenario: Unchanged version is not re-read

- **WHEN** a refresh finds the same stat version that was loaded last
- **THEN** the shell does not read or re-parse the file and publishes no change

#### Scenario: Shell write updates the state

- **WHEN** the settings surface writes `exo.json`
- **THEN** the shell publishes the written declaration without a focus refresh

#### Scenario: Invalid external edit disables entries

- **WHEN** an external edit makes `exo.json` invalid while the workspace is ready
- **THEN** the next refresh publishes an invalid state with zero usable entries and the workspace stays usable

#### Scenario: Workspace switch resets the declaration

- **WHEN** the user switches from workspace A to workspace B
- **THEN** A's entries and issues are gone, and a late read from A cannot update B

#### Scenario: Oversized file is rejected

- **WHEN** `exo.json` exceeds 256 KiB
- **THEN** the shell reports `too-large`, uses zero entries, and keeps the rest of the workspace usable

#### Scenario: Unreadable file is reported

- **WHEN** reading `exo.json` fails with a permission or I/O error
- **THEN** the shell reports `not-readable`, uses zero entries, and keeps the rest of the workspace usable

#### Scenario: No manifest request

- **WHEN** the shell loads or refreshes the declaration
- **THEN** it makes no network request to any manifest URL and creates no iframe

### Requirement: Configuration error vocabulary

The shell SHALL report configuration problems as `invalid-json`,
`unsupported-version`, `invalid-config`, `too-many-plugins`,
`duplicate-manifest`, `too-large`, `not-readable` or `conflict`, each with the
file path, the failing JSON Pointer when known, and the entry index when the
problem belongs to one entry, and SHALL not include raw file content in the
diagnostic.

#### Scenario: Parse failure

- **WHEN** the file is not valid JSON
- **THEN** the diagnostic code is `invalid-json` and no entries are usable

#### Scenario: Unknown schema version

- **WHEN** `schemaVersion` is not `1`
- **THEN** the diagnostic code is `unsupported-version` and the document is not partially parsed

#### Scenario: Shape and field failures

- **WHEN** a required field is missing, a value has the wrong type or an unknown field is present
- **THEN** the diagnostic code is `invalid-config` and the failing JSON Pointer is included

#### Scenario: Limit failure

- **WHEN** the declaration has more than 50 entries
- **THEN** the diagnostic code is `too-many-plugins` and no entry is usable

#### Scenario: Duplicate failure

- **WHEN** two entries name the same manifest URL
- **THEN** the diagnostic code is `duplicate-manifest` and both entry indices are included

#### Scenario: Size failure

- **WHEN** the file exceeds 256 KiB
- **THEN** the diagnostic code is `too-large`

#### Scenario: Read failure

- **WHEN** the file cannot be read because of a permission or I/O error
- **THEN** the diagnostic code is `not-readable`

#### Scenario: Stale write

- **WHEN** a write is attempted with a version that no longer matches the file
- **THEN** the diagnostic code is `conflict` and the file is unchanged

#### Scenario: Diagnostics contain no content

- **WHEN** any configuration problem is reported
- **THEN** the diagnostic names the path, code, pointer and entry but never includes raw file text

### Requirement: Canonical configuration rewrite

The shell SHALL write `exo.json` only through the workspace session, SHALL
serialize it as 2-space JSON with `schemaVersion` before `plugins` and `manifest`
before `enabled`, SHALL write `enabled` explicitly, SHALL end with a newline,
SHALL validate before writing, and SHALL use the loaded version as `ifVersion` so
a stale rewrite fails with `conflict` instead of overwriting an external edit.

#### Scenario: Canonical bytes

- **WHEN** the shell writes a declaration
- **THEN** the file is 2-space JSON with `schemaVersion` before `plugins`, `manifest` before `enabled`, and a trailing newline

#### Scenario: Enabled is explicit

- **WHEN** an entry omits `enabled` and is written by the shell
- **THEN** the canonical file includes `"enabled": true`

#### Scenario: Missing file is created

- **WHEN** the user adds the first plugin to a workspace without `exo.json`
- **THEN** the shell creates `/exo.json` with `schemaVersion: 1` and the new entry

#### Scenario: Invalid content is not written

- **WHEN** a rewrite would produce an invalid document
- **THEN** the shell writes nothing and reports the validation issues

#### Scenario: Stale rewrite does not overwrite

- **WHEN** the file changed after it was loaded and the shell attempts a rewrite with the old version
- **THEN** the write fails with `conflict`, the external content is preserved, and the shell reloads it

#### Scenario: Intended change only

- **WHEN** an already-canonical declaration is changed by adding, removing, enabling or disabling one entry
- **THEN** the diff contains only that entry or flag and no unrelated field changes

#### Scenario: Formatting is normalized

- **WHEN** a valid declaration with different indentation or key order is rewritten
- **THEN** the file is canonicalized and the settings surface states that formatting and key order are not preserved

#### Scenario: Comments are not valid JSON

- **WHEN** `exo.json` contains comments
- **THEN** validation reports `invalid-json` and the shell does not strip the comments or write the file
