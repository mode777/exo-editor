# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
