# Spec Delta

## MODIFIED Requirements

### Requirement: Content-view contribution shape

A `contributes.contentViews` entry SHALL have `id`, `title` and `entry`, and MAY declare a companion binding as defined by Surface companion declaration. The id SHALL match `^[a-z0-9][a-z0-9.-]{0,63}$` and be unique among content views, the title SHALL be 1-80 characters, and the entry SHALL follow the plugin-root rules.

#### Scenario: Valid content view

- **WHEN** a manifest declares `{ "id": "tutorial", "title": "Tutorial", "entry": "views/tutorial.html" }`
- **THEN** validation accepts it and the view is available for registration

#### Scenario: Valid companion panel

- **WHEN** a manifest declares a secondary panel `asset-params` and a content view with `companionPanel: "asset-params"`
- **THEN** validation accepts the view, and the association is available for registration without a new permission

#### Scenario: Content view without a companion

- **WHEN** a content view omits both companion fields
- **THEN** validation accepts it and the shell opens it without revealing a companion

#### Scenario: Shared companion panel

- **WHEN** two content views in one manifest declare the same panel as a companion in either field
- **THEN** validation accepts both because the panel is declared once and shared

#### Scenario: Unknown companion panel

- **WHEN** a content view names a companion the manifest does not declare
- **THEN** validation fails with `invalid-manifest` and names the content view's companion field

#### Scenario: Primary companion panel

- **WHEN** a content view names a panel declared with `location: "primary"`
- **THEN** validation accepts the association because a companion may use any declared panel location

#### Scenario: Bottom companion panel

- **WHEN** a content view names a panel declared with `location: "bottom"`
- **THEN** validation accepts the association because a companion may use any declared panel location

#### Scenario: Invalid companion panel id

- **WHEN** a companion is empty, is not a string or does not match the panel-id form
- **THEN** validation fails with `invalid-manifest` and names the companion field

#### Scenario: Duplicate content-view id

- **WHEN** a manifest declares two content views with the same id
- **THEN** validation fails with `invalid-manifest` and none is registered

#### Scenario: Content view without an entry

- **WHEN** a content view omits `entry`
- **THEN** validation fails with `invalid-manifest`

## ADDED Requirements

### Requirement: Surface companion declaration

A `contributes.fileEditors` entry MAY declare `companionPanels`, and a `contributes.contentViews` entry MAY declare `companionPanels` or the legacy singular `companionPanel`. A companion SHALL use the panel-id form and name a panel declared in the same manifest. The list SHALL contain 1-3 unique ids and at most one panel per `primary`, `secondary` or `bottom` location; a panel MAY be shared by several contributions.

#### Scenario: File editor companion list

- **WHEN** a file editor declares `companionPanels: ["outline", "problems"]` and both panels exist in the same manifest
- **THEN** validation accepts the editor and preserves both associations for registration

#### Scenario: Companions in all locations

- **WHEN** a content view declares one primary, one secondary and one bottom panel as companions
- **THEN** validation accepts all three because each uses a different location

#### Scenario: Legacy alias is one companion

- **WHEN** a content view declares `companionPanel: "outline"` and no `companionPanels`
- **THEN** validation accepts it and the shell treats it as a one-item companion list

#### Scenario: Both companion fields

- **WHEN** one content view declares both `companionPanel` and `companionPanels`
- **THEN** validation fails with `invalid-manifest` and names both fields

#### Scenario: Empty companion list

- **WHEN** a contribution declares `companionPanels: []`
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Duplicate companion id

- **WHEN** one contribution lists the same panel id twice
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Duplicate companion location

- **WHEN** one contribution lists two secondary panels
- **THEN** validation fails with `invalid-manifest` because one contribution may bind at most one panel per location

#### Scenario: More than three companions

- **WHEN** one contribution lists more than three panel ids
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Unknown file-editor companion

- **WHEN** a file editor names a panel the same manifest does not declare
- **THEN** validation fails with `invalid-manifest` and names the file editor's companion field

#### Scenario: Companion consent is unchanged

- **WHEN** an approved plugin adds or changes a companion declaration
- **THEN** the shell does not re-prompt and the consent fingerprint is unchanged because the panel and editor declarations already describe the visible surfaces
