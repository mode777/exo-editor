# Spec Delta

## ADDED Requirements

### Requirement: Explorer new-file templates

The shell SHALL add active plugin templates to the explorer New File menu and the command palette, grouped by plugin name, while keeping Empty File available. It SHALL disable template entries in a read-only workspace and remove them when the plugin stops.

#### Scenario: Template menu

- **WHEN** one or more templates are active
- **THEN** the explorer New File action offers Empty File and each template under its plugin name

#### Scenario: Palette entries

- **WHEN** templates are active
- **THEN** the command palette lists a New File entry per template with the plugin name as its category

#### Scenario: Empty file stays available

- **WHEN** templates exist
- **THEN** Empty File still opens the existing name dialog with no default content

#### Scenario: Read-only workspace

- **WHEN** the workspace session is not writable
- **THEN** template entries are absent or disabled and no create dialog opens

#### Scenario: Plugin removal

- **WHEN** a plugin with active templates is disabled, removed or revoked
- **THEN** its menu and palette entries disappear without a reload

#### Scenario: Directory target

- **WHEN** the user invokes a template from the explorer
- **THEN** the dialog starts in the selected directory, or the workspace root when the selection is a file or absent

### Requirement: New-file Save As dialog

The shell SHALL render one shell-owned Save As dialog for a runtime request or a template, SHALL show the plugin name, directory, editable name, content size and a bounded text preview, SHALL trap focus, close on Escape and restore focus, and SHALL report a collision without closing.

#### Scenario: Dialog content

- **WHEN** a New File template or runtime request opens the dialog
- **THEN** it names the plugin, shows the start directory and the size, and for text content shows a bounded preview

#### Scenario: Editable name

- **WHEN** the dialog opens with a suggested or template name
- **THEN** the name is editable, the directory is navigable, and the final path is shown to the user

#### Scenario: Keyboard and focus

- **WHEN** the dialog opens from the keyboard
- **THEN** focus moves to the name field, Tab stays inside, Escape cancels and focus returns to the invoking control

#### Scenario: Cancellation

- **WHEN** the user cancels or closes the dialog
- **THEN** no write occurs, the runtime request resolves as cancelled and no error is shown

#### Scenario: Collision

- **WHEN** the chosen name already exists
- **THEN** the dialog reports `already-exists`, stays open with the name editable, and writes nothing

#### Scenario: Binary content

- **WHEN** the content is binary
- **THEN** the dialog shows the byte size and a binary label and does not decode or preview it

#### Scenario: Plugin stops with the dialog open

- **WHEN** the owning plugin is removed or the workspace switches
- **THEN** the dialog closes before the plugin or session is released and no write occurs

#### Scenario: Automated scan

- **WHEN** the dialog is rendered and scanned with the accessibility rule engine
- **THEN** no violation is reported for an Exo-owned node

#### Scenario: No plugin dialog text

- **WHEN** a plugin supplies a suggested name
- **THEN** the dialog uses it only as a validated name hint and accepts no plugin-supplied title, description or preselected path
