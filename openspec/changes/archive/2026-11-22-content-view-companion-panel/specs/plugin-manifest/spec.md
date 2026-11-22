# Spec Delta

## MODIFIED Requirements

### Requirement: Content-view contribution shape

A `contributes.contentViews` entry SHALL have `id`, `title` and `entry`, and MAY have an optional `companionPanel`. The id SHALL match `^[a-z0-9][a-z0-9.-]{0,63}$` and be unique among content views, and the title SHALL be 1-80 characters. The entry SHALL follow the plugin-root rules. A `companionPanel` SHALL use the panel-id form and name a panel in the same manifest with `location: "secondary"`.

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

#### Scenario: Invalid companion panel id

- **WHEN** `companionPanel` is empty, is not a string or does not match the panel-id form
- **THEN** validation fails with `invalid-manifest` and names the `companionPanel` field

#### Scenario: Duplicate content-view id

- **WHEN** a manifest declares two content views with the same id
- **THEN** validation fails with `invalid-manifest` and none is registered

#### Scenario: Content view without an entry

- **WHEN** a content view omits `entry`
- **THEN** validation fails with `invalid-manifest`
