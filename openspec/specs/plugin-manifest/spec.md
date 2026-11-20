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

### Requirement: Entry pages are bound to the plugin root

The shell SHALL require `runtime.entry`, every `contributes.fileEditors[].entry`, every `contributes.panels[].entry` and every `contributes.contentViews[].entry` to be a relative HTML path with no query, fragment or `..` segment, SHALL resolve each entry against the final manifest URL, SHALL require each resolved entry to share the manifest's origin, and SHALL confine every page the plugin loads to the directory tree rooted at the resolved controller entry (siblings and descendants allowed, parents and unrelated directories rejected).

#### Scenario: Cross-origin editor page is rejected

- **WHEN** a manifest served from `https://plugins.example.com` declares an editor entry on `https://cdn.example.net/editor.html`
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

#### Scenario: Panel and content-view entries follow the same rule

- **WHEN** a panel or content view declares `entry: "views/outline.html"` beside `runtime.entry`
- **THEN** it is accepted, while `../views/outline.html` or a page on another origin is rejected

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
Earliest means the earlier enabled entry in `exo.json`, then the earlier
registration message within that plugin, so timing does not decide.

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

The approval prompt SHALL display the plugin's name, id, version and publisher, the exact manifest origin including scheme, host and port, the controller entry URL, the plugin root, each declared editor entry, whether each editor renders its own frame or stays headless, each declared panel with its title and left or right location, each declared content view, the requested permissions in plain language, the declared globs with labels, whether the plugin can write to the workspace, whether its panels can open files or views, and whether it shares the shell origin.

#### Scenario: Exact origin is shown

- **WHEN** the consent prompt is rendered
- **THEN** it shows the origin as text and does not replace it with a logo, a display name or a registrable-domain label

#### Scenario: Approved root is visible

- **WHEN** the consent prompt is rendered for `https://plugins.example.com/monaco/plugin.html`
- **THEN** it shows the plugin root `https://plugins.example.com/monaco/` so the user can see which directory the approval covers

#### Scenario: Frame rendering is disclosed

- **WHEN** a contribution declares `rendering: "frame"`
- **THEN** the consent prompt states that the plugin renders its own editor surface inside the document area

#### Scenario: Panels are disclosed

- **WHEN** a manifest declares a primary and a secondary panel
- **THEN** the prompt lists their titles, their locations and that a primary panel adds an activity-bar item

#### Scenario: Content views are disclosed

- **WHEN** a manifest declares a content view
- **THEN** the prompt lists its title and that it opens as a read-only tab

#### Scenario: Navigation intents are disclosed

- **WHEN** a plugin declares a panel or content view and `workspace:read`
- **THEN** the prompt states that the plugin can open workspace files and views, and a plugin without read is described as unable to open files

### Requirement: Consent fingerprint

The shell SHALL persist consent machine-wide, keyed by manifest origin and plugin id, together with a fingerprint computed over exactly the plugin id, entry origin, plugin root path, sorted permissions, sorted editor globs and priorities, and each editor's frame-rendering flag when it is `"frame"`. A different fingerprint SHALL be treated as consent not granted, and a manifest field that changes autonomous data access or an existing approved surface SHALL be added to the fingerprint input in the same change that introduces it. `contributes.configuration`, `contributes.panels` and `contributes.contentViews` declare user-invoked shell state or surfaces, do not grant autonomous access, and SHALL NOT change the fingerprint.

#### Scenario: Cosmetic release keeps consent

- **WHEN** a new manifest version changes only name, description, icon, homepage or version
- **THEN** the stored consent remains valid and the user is not prompted

#### Scenario: Widers re-prompt

- **WHEN** a manifest adds a permission, adds or widens a glob, changes an existing priority, moves its entry origin or moves the plugin root
- **THEN** the fingerprint changes and the plugin requires fresh consent before any frame is mounted

#### Scenario: Frame surface re-prompts

- **WHEN** an existing editor contribution changes from `rendering: "hidden"` to `rendering: "frame"`
- **THEN** the fingerprint changes and the plugin requires fresh consent before its visible frame is mounted

#### Scenario: Returning to hidden keeps consent

- **WHEN** an editor contribution changes from `rendering: "frame"` to `rendering: "hidden"` without any other capability change
- **THEN** the fingerprint may return to the previously approved value and the plugin does not gain a visible surface without approval

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

- **WHEN** a new manifest version adds, removes or changes its `contributes.configuration` declaration without changing its origin, root, permissions or editor globs
- **THEN** the fingerprint is unchanged and the user is not prompted again

#### Scenario: Adding a panel or content view keeps consent

- **WHEN** a new manifest version adds, removes or changes a `contributes.panels` or `contributes.contentViews` declaration without changing its origin, root, permissions or editor globs
- **THEN** the fingerprint is unchanged, the stored consent remains valid and the new surface appears after the plugin's next registration

#### Scenario: View surfaces stay inside the approved root

- **WHEN** a new panel or content-view page is added inside the already-approved plugin root
- **THEN** it loads without a new prompt because the prompt approved the directory tree

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

### Requirement: Editor rendering surface declaration

A `contributes.fileEditors` entry SHALL accept an optional `rendering` value of
`"hidden"` or `"frame"`, SHALL default to `"hidden"` when omitted, and SHALL
reject any other value with `invalid-manifest`. `"frame"` permits the shell to
display that contribution's handler iframe in the document area; it SHALL NOT
grant storage, filesystem, event or network access or change the sandbox.

#### Scenario: Omitted rendering stays hidden

- **WHEN** a contribution omits `rendering`
- **THEN** the shell treats it as `"hidden"` and keeps its handler frame out of
  the visible document area

#### Scenario: Frame rendering is accepted

- **WHEN** a contribution declares `rendering: "frame"`
- **THEN** validation succeeds, the contribution keeps its glob and priority, and
  the shell may display its handler frame for the active document

#### Scenario: Unknown rendering is rejected

- **WHEN** a contribution declares `rendering: "overlay"` or any value other than
  `"hidden"` or `"frame"`
- **THEN** validation fails with `invalid-manifest` naming the contribution

#### Scenario: Rendering is not a capability

- **WHEN** a same-origin contribution declares `rendering: "frame"`
- **THEN** its iframe still uses `sandbox="allow-scripts"` and has no storage or
  parent DOM access

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

### Requirement: Panel contribution shape

A `contributes.panels` entry SHALL have `id`, `title`, optional `icon`, `location` of `primary` or `secondary`, and `entry`. The id SHALL match `^[a-z0-9][a-z0-9.-]{0,63}$` and be unique among panels, the title SHALL be 1-80 characters, the icon SHALL be 1-40 characters matching `^[a-z0-9-]+$` and name a Codicon, and the entry SHALL follow the plugin-root rules.

#### Scenario: Valid panel

- **WHEN** a manifest declares `{ "id": "outline", "title": "Outline", "icon": "list-tree", "location": "primary", "entry": "views/outline.html" }`
- **THEN** validation accepts it and the panel is available for registration

#### Scenario: Missing location

- **WHEN** a panel omits `location` or uses a value other than `primary` or `secondary`
- **THEN** validation fails with `invalid-manifest` and names the field

#### Scenario: Invalid title or icon

- **WHEN** a panel title is empty or longer than 80 characters, or its icon contains uppercase letters or a slash
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Panel without an icon

- **WHEN** a panel omits `icon`
- **THEN** validation accepts it and the shell uses its default Codicon

### Requirement: Content-view contribution shape

A `contributes.contentViews` entry SHALL have `id`, `title` and `entry`. The id SHALL match `^[a-z0-9][a-z0-9.-]{0,63}$` and be unique among content views, the title SHALL be 1-80 characters, and the entry SHALL follow the plugin-root rules.

#### Scenario: Valid content view

- **WHEN** a manifest declares `{ "id": "tutorial", "title": "Tutorial", "entry": "views/tutorial.html" }`
- **THEN** validation accepts it and the view is available for registration

#### Scenario: Duplicate content-view id

- **WHEN** a manifest declares two content views with the same id
- **THEN** validation fails with `invalid-manifest` and none is registered

#### Scenario: Content view without an entry

- **WHEN** a content view omits `entry`
- **THEN** validation fails with `invalid-manifest`

### Requirement: View contribution limits

A manifest SHALL declare at most eight panels across both locations and at most sixteen content views. The contribution arrays SHALL be optional and an empty array SHALL mean no contribution.

#### Scenario: Panel limit

- **WHEN** a manifest declares nine panels
- **THEN** validation fails with `invalid-manifest` and no panel is registered

#### Scenario: Content-view limit

- **WHEN** a manifest declares seventeen content views
- **THEN** validation fails with `invalid-manifest` and no view is registered

#### Scenario: Empty arrays

- **WHEN** a manifest declares `panels: []` or `contentViews: []`
- **THEN** validation accepts it and the plugin contributes no surface of that kind

### Requirement: View surface consent display

The shell SHALL list declared panels and content views in the first-grant consent prompt, SHALL identify the plugin by name in activity-bar tooltips, the secondary-view picker and the content-view document chrome, and SHALL NOT require a new approval when an already-approved plugin adds or changes one of these declarations.

#### Scenario: First grant lists the surfaces

- **WHEN** a manifest with panels and content views is shown for the first time
- **THEN** the prompt lists each title and location under the plugin's approved surface

#### Scenario: Added surface is named

- **WHEN** an already-approved plugin adds a primary panel and the user opens it
- **THEN** the activity-bar tooltip and the panel header identify the plugin, and no consent dialog is reopened

#### Scenario: Surface changes do not widen data access

- **WHEN** an already-approved plugin adds a panel that only renders static content
- **THEN** the panel appears without a fingerprint change and the plugin's data permissions are unchanged

