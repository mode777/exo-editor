# Spec Delta

## ADDED Requirements

### Requirement: User-mediated file selection

An active, visible handler SHALL be able to ask the shell to open a workspace file picker. The picker SHALL be shell-owned, SHALL show a fixed notice naming the plugin that requested it, SHALL return only the selected `/`-rooted paths, and SHALL NOT give the plugin a handle, `File`, `Blob`, metadata or content. The plugin SHALL read selected paths through `plugin/request-file`.

#### Scenario: Relink one missing file

- **WHEN** an active visible handler asks for one workspace file and the user selects `textures/albedo.png`
- **THEN** the handler receives `/textures/albedo.png`, reads it with `plugin/request-file`, and no content crossed in the picker reply

#### Scenario: Select several files

- **WHEN** the handler requests multiple selection and the user selects three files
- **THEN** the reply carries the three paths and the plugin reads each through the normal read flow

#### Scenario: User cancels

- **WHEN** the user cancels the picker
- **THEN** the handler receives an empty path list, performs no read and keeps its document state unchanged

#### Scenario: Hidden handler has no picker

- **WHEN** a hidden, inactive or unfocused handler requests a picker
- **THEN** the shell shows no picker and the handler receives `permission-denied`

#### Scenario: Shell-owned disclosure

- **WHEN** the picker opens
- **THEN** it names the requesting plugin in shell-owned text, accepts no plugin-supplied title, message or preselected path, and states that the plugin will be able to read the selected files

#### Scenario: Keyboard and focus lifecycle

- **WHEN** the picker is opened from the keyboard or from a plugin button
- **THEN** focus enters the picker, Tab and Shift+Tab stay inside it, Escape cancels, and focus returns to the plugin frame as required by the accessible-shell requirement; the plugin may restore focus to its own button inside the frame

#### Scenario: Reserved paths never appear

- **WHEN** the handler navigates the picker
- **THEN** `/exo.json` and `/.exo/**` are neither shown nor returned, and a path that becomes reserved before the reply is denied

#### Scenario: Read permission remains the gate

- **WHEN** a plugin without `workspace:read` has no handler session
- **THEN** it cannot reach the picker, and every selected path is still subject to the read permission, containment, reserved-path and size checks

#### Scenario: Selection is not a write grant

- **WHEN** a read-only plugin selects a file
- **THEN** the picker returns its path, the plugin can read it if `workspace:read` allows, and no write to that path becomes possible outside the existing save flow
