# Spec Delta

## Purpose

Defines the `exo.json` and plugin-manifest shape, validation, consent display and
engine compatibility. This delta adds the `bottom` panel location and keeps
companion panels secondary-only.

## MODIFIED Requirements

### Requirement: Consent prompt names the origin and the approved surface

The approval prompt SHALL display the plugin's name, id, version and publisher, the exact manifest origin including scheme, host and port, the controller entry URL, the plugin root, each declared editor entry, whether each editor renders its own frame or stays headless, each declared panel with its title and primary, secondary or bottom location, each declared content view, each declared command with its title, target and menu placements, the requested permissions in plain language, the declared globs with labels, whether the plugin can write to the workspace, whether its panels can open files or views, and whether it shares the shell origin.

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

- **WHEN** a manifest declares a primary, a secondary and a bottom panel
- **THEN** the prompt lists their titles and locations, says that a primary panel adds an activity-bar item and that a bottom panel appears as a bottom-region tab

#### Scenario: Content views are disclosed

- **WHEN** a manifest declares a content view
- **THEN** the prompt lists its title and that it opens as a read-only tab

#### Scenario: Commands are disclosed

- **WHEN** a manifest declares commands
- **THEN** the prompt lists each command's title, whether it acts on the active editor, a panel or a content view, and where it can appear

#### Scenario: Navigation intents are disclosed

- **WHEN** a plugin declares a panel or content view and `workspace:read`
- **THEN** the prompt states that the plugin can open workspace files and views, and a plugin without read is described as unable to open files

### Requirement: Manifest schema and engine versioning

The shell SHALL accept exactly manifest `schemaVersion` `1`, SHALL require `engines.exo` to include the shell version, and SHALL report incompatible plugins instead of attempting to load them. A manifest that uses a field introduced in a later shell SHALL declare an `engines.exo` range that excludes shells without that field, so the older shell reports `incompatible-engine` before parsing it. The manifest schema version SHALL be independent of the plugin protocol major version and the shell version.

#### Scenario: Unknown schema version

- **WHEN** a manifest declares `schemaVersion: 2`
- **THEN** it is reported as `unsupported-version` and is not partially parsed

#### Scenario: Engine range excludes the shell

- **WHEN** `engines.exo` does not include the running shell version
- **THEN** the plugin is listed as incompatible with both versions shown and no frame is mounted

#### Scenario: Bottom panel on an older shell

- **WHEN** a manifest declares a bottom panel and `engines.exo` excludes the running shell
- **THEN** the shell reports `incompatible-engine` before validating or registering the panel and creates no frame

#### Scenario: Bottom panel keeps the schema version

- **WHEN** a supporting shell validates a manifest with `schemaVersion: 1` and a bottom panel
- **THEN** validation accepts it without a manifest schema change

### Requirement: Panel contribution shape

A `contributes.panels` entry SHALL have `id`, `title`, optional `icon`, `location` of `primary`, `secondary` or `bottom`, and `entry`. The id SHALL match `^[a-z0-9][a-z0-9.-]{0,63}$` and be unique among panels, the title SHALL be 1-80 characters, the icon SHALL be 1-40 characters matching `^[a-z0-9-]+$` and name a Codicon, and the entry SHALL follow the plugin-root rules.

#### Scenario: Valid panel

- **WHEN** a manifest declares `{ "id": "outline", "title": "Outline", "icon": "list-tree", "location": "primary", "entry": "views/outline.html" }`
- **THEN** validation accepts it and the panel is available for registration

#### Scenario: Valid bottom panel

- **WHEN** a manifest declares `{ "id": "inspection", "title": "Inspection", "location": "bottom", "entry": "views/inspection.html" }`
- **THEN** validation accepts it and the panel is available for registration as a bottom tab

#### Scenario: Missing location

- **WHEN** a panel omits `location`
- **THEN** validation fails with `invalid-manifest` and names the field

#### Scenario: Unknown location

- **WHEN** a panel uses a location other than `primary`, `secondary` or `bottom`
- **THEN** validation fails with `invalid-manifest` and names the field

#### Scenario: Invalid title or icon

- **WHEN** a panel title is empty or longer than 80 characters, or its icon contains uppercase letters or a slash
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Panel without an icon

- **WHEN** a panel omits `icon`
- **THEN** validation accepts it and the shell uses its default Codicon

### Requirement: Content-view contribution shape

A `contributes.contentViews` entry SHALL have `id`, `title` and `entry`, and MAY have an optional `companionPanel`. The id SHALL match `^[a-z0-9][a-z0-9.-]{0,63}$` and be unique among content views, and the title SHALL be 1-80 characters. The entry SHALL follow the plugin-root rules. A `companionPanel` SHALL use the panel-id form and name a panel in the same manifest with `location: "secondary"`; a primary or bottom panel SHALL be rejected.

#### Scenario: Valid content view

- **WHEN** a manifest declares `{ "id": "tutorial", "title": "Tutorial", "entry": "views/tutorial.html" }`
- **THEN** validation accepts it and the view is available for registration

#### Scenario: Valid companion panel

- **WHEN** a manifest declares a secondary panel `asset-params` and a content view with `companionPanel: "asset-params"`
- **THEN** validation accepts the view, and the association is available for registration without a new permission

#### Scenario: Content view without a companion

- **WHEN** a content view omits `companionPanel`
- **THEN** validation accepts it and the shell opens it without revealing a companion

#### Scenario: Shared companion panel

- **WHEN** two content views in one manifest declare the same secondary panel as `companionPanel`
- **THEN** validation accepts both because the panel is declared once and shared

#### Scenario: Unknown companion panel

- **WHEN** a content view names a `companionPanel` the manifest does not declare
- **THEN** validation fails with `invalid-manifest` and names the content view's `companionPanel` field

#### Scenario: Primary companion panel

- **WHEN** a content view names a panel declared with `location: "primary"`
- **THEN** validation fails with `invalid-manifest` and reports that a companion panel must be secondary

#### Scenario: Bottom companion panel

- **WHEN** a content view names a panel declared with `location: "bottom"`
- **THEN** validation fails with `invalid-manifest` and reports that a companion panel must be secondary

#### Scenario: Invalid companion panel id

- **WHEN** `companionPanel` is empty, is not a string or does not match the panel-id form
- **THEN** validation fails with `invalid-manifest` and names the `companionPanel` field

#### Scenario: Duplicate content-view id

- **WHEN** a manifest declares two content views with the same id
- **THEN** validation fails with `invalid-manifest` and none is registered

#### Scenario: Content view without an entry

- **WHEN** a content view omits `entry`
- **THEN** validation fails with `invalid-manifest`

### Requirement: View contribution limits

A manifest SHALL declare at most eight panels across primary, secondary and bottom locations and at most sixteen content views. The contribution arrays SHALL be optional and an empty array SHALL mean no contribution.

#### Scenario: Panel limit

- **WHEN** a manifest declares nine panels across the locations
- **THEN** validation fails with `invalid-manifest` and no panel is registered

#### Scenario: Content-view limit

- **WHEN** a manifest declares seventeen content views
- **THEN** validation fails with `invalid-manifest` and no view is registered

#### Scenario: Empty arrays

- **WHEN** a manifest declares `panels: []` or `contentViews: []`
- **THEN** validation accepts it and the plugin contributes no surface of that kind

### Requirement: View surface consent display

The shell SHALL list declared panels and content views in the first-grant consent prompt, SHALL identify the plugin by name in activity-bar tooltips, the secondary-view picker, bottom-panel tabs and the content-view document chrome, and SHALL NOT require a new approval when an already-approved plugin adds or changes one of these declarations.

#### Scenario: First grant lists the surfaces

- **WHEN** a manifest with primary, secondary and bottom panels and content views is shown for the first time
- **THEN** the prompt lists each title and location under the plugin's approved surface

#### Scenario: Added surface is named

- **WHEN** an already-approved plugin adds a primary or bottom panel and the user opens it
- **THEN** the activity-bar tooltip or bottom tab and the panel header identify the plugin, and no consent dialog is reopened

#### Scenario: Bottom panel does not widen data access

- **WHEN** an already-approved plugin adds a bottom panel that only renders static content
- **THEN** the panel appears without a fingerprint change and the plugin's data permissions are unchanged

#### Scenario: Surface changes do not widen data access

- **WHEN** an already-approved plugin adds a panel that only renders static content
- **THEN** the panel appears without a fingerprint change and the plugin's data permissions are unchanged
