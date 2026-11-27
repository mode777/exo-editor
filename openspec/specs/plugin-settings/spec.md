# plugin-settings Specification

## Purpose

Defines how a plugin's declared configuration becomes shell-owned, workspace-scoped
settings that the user edits in the shell and the plugin receives without the
shell understanding or writing the values into the workspace.

## Requirements

### Requirement: Declared settings are workspace-scoped

The shell SHALL accept a plugin's contributed configuration only from a validated
manifest and SHALL treat every declared property as a workspace-scoped setting
with a type, a default, an optional enum and an optional description.

#### Scenario: Supported setting types

- **WHEN** a validated manifest declares boolean, string and number settings
- **THEN** each is available as a workspace-scoped setting with its declared default

#### Scenario: Plugin declares no configuration

- **WHEN** a plugin's manifest declares no configuration
- **THEN** the shell renders no settings for it and sends an empty settings map to
  its frames

### Requirement: Settings are shell-owned and isolated

The shell SHALL store plugin settings outside the workspace and outside
`exo.json`, keyed by workspace identity and plugin identity
(`manifest origin::plugin id`), and SHALL NOT expose one plugin's values to
another plugin, a workspace file or a URL.

#### Scenario: Editing a setting leaves the workspace untouched

- **WHEN** the user changes a plugin setting
- **THEN** no workspace file, `exo.json` or document tab changes and the value is
  written only to shell storage

#### Scenario: Identity includes the origin

- **WHEN** two manifests on different origins declare the same plugin id
- **THEN** their settings are stored and delivered separately

#### Scenario: Another plugin never receives the values

- **WHEN** one plugin's setting changes while another plugin has a handler frame
  subscribed to `config/changed`
- **THEN** only the named plugin's frames receive the event and the other plugin
  receives neither the values nor an initialization containing them

### Requirement: Stored values resolve to defaults

The shell SHALL use a stored setting only when it satisfies the declared type and
enum; otherwise it SHALL use the declared default. An edit that does not satisfy
the declaration SHALL be rejected without changing the active or stored value.

#### Scenario: Missing value uses the default

- **WHEN** no stored value exists for a declared setting
- **THEN** the shell uses the manifest default in the settings surface and in
  `shell/init`

#### Scenario: Invalid edit is rejected

- **WHEN** the user enters a value that does not match the declared type or enum
- **THEN** the shell keeps the previous value, stores nothing and shows why the
  edit was rejected

#### Scenario: Enum is closed

- **WHEN** a setting declares an enum and the user selects a value inside it
- **THEN** that value is accepted, and a value outside it is not

### Requirement: Invalid stored values are visible

When a stored value no longer satisfies its declaration, the shell SHALL use the
declared default, keep the plugin and workspace usable, and show a visible warning
naming the setting.

#### Scenario: Schema change invalidates a stored value

- **WHEN** a plugin's declaration changes so a stored value no longer matches its
  type or enum
- **THEN** the shell uses the default, sends the default to the plugin and shows a
  warning for that setting

#### Scenario: Warning clears after a valid value

- **WHEN** the user saves a valid value for a setting that was falling back
- **THEN** the warning disappears and the new value becomes active and persisted

### Requirement: Settings persist per workspace

The shell SHALL persist settings across reload for the same workspace identity,
SHALL isolate them from every other workspace, and SHALL detach them on workspace
switch so a late load from the previous workspace cannot mutate the next one.

#### Scenario: Reload restores values

- **WHEN** the page reloads and the same workspace is restored
- **THEN** the stored values are active again and the next `shell/init` carries
  them instead of the defaults

#### Scenario: Another workspace sees its own values

- **WHEN** the user switches to a different workspace with the same plugin
- **THEN** that workspace's values, or the defaults, are used and the previous
  workspace's values are neither shown nor delivered

#### Scenario: Late load is ignored

- **WHEN** a settings read from a released workspace resolves after a new
  workspace is attached
- **THEN** it is discarded and cannot overwrite the new workspace's state

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

### Requirement: Storage failures are explicit

If the settings store cannot be read or written, the shell SHALL continue with
in-memory values for the session, SHALL show that changes may not survive reload,
and SHALL NOT block the workspace or plugin frames.

#### Scenario: Read failure falls back to defaults

- **WHEN** the settings store cannot be read for the active workspace
- **THEN** declared defaults are used, the plugin still loads and the settings
  surface shows a storage warning

#### Scenario: Write failure keeps the session value

- **WHEN** a setting change cannot be persisted
- **THEN** the value applies for the current session and the shell warns that it
  may not survive reload
