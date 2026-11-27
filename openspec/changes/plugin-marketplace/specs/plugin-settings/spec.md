# Spec Delta

## MODIFIED Requirements

### Requirement: Settings surface

The shell SHALL render each declared setting in the extension's shell-owned
details tab with an input for its type, its current value, its description and
any validation warning, and SHALL update the shell-owned store when the user
changes it. Settings SHALL remain editable when the workspace is read-only, and
the settings dialog SHALL NOT duplicate the contributed inputs.

#### Scenario: Inputs match the declared types

- **WHEN** a plugin declares boolean, string and enum settings
- **THEN** its extension details tab renders a checkbox, a text field and a select with the declared options and descriptions

#### Scenario: Change is visible immediately

- **WHEN** the user changes a setting in the extension details tab
- **THEN** the new value is shown at once and written to the shell-owned store

#### Scenario: Read-only workspace still allows settings

- **WHEN** the active workspace is read-only
- **THEN** contributed settings remain editable in the extension details tab because they are shell state, not workspace files

#### Scenario: Settings are not duplicated

- **WHEN** the user opens the settings dialog's plugin debug section
- **THEN** it shows raw configuration, issues, status and the log but no contributed setting input

#### Scenario: Installed without a manifest

- **WHEN** an installed plugin has not loaded a valid manifest yet
- **THEN** its details tab shows no contributed settings and does not invent defaults

#### Scenario: Catalog entry before install

- **WHEN** a marketplace entry is not installed and its manifest has not been fetched
- **THEN** the details tab shows feed metadata and no contributed setting input

#### Scenario: Workspace switch

- **WHEN** the user switches workspaces
- **THEN** settings from the previous workspace are not shown in the new workspace's extension details
