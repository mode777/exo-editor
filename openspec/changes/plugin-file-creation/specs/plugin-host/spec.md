# Spec Delta

## ADDED Requirements

### Requirement: New-file template registration

The host SHALL record registered new-file template ids only after `plugin/register-complete`, SHALL reject a template registration from a plugin without `workspace:write` with `permission-denied`, SHALL expose active templates in the workspace-scoped snapshot with their label and default file name, and SHALL remove them when the plugin stops.

#### Scenario: Registration activates on completion

- **WHEN** a controller registers a template but has not sent `plugin/register-complete`
- **THEN** no template is active and the explorer menu is unchanged

#### Scenario: Subset registration

- **WHEN** a manifest declares three templates and the controller registers one
- **THEN** only that template is active and the other two remain declared but unregistered

#### Scenario: Missing write permission

- **WHEN** a plugin without `workspace:write` registers a declared template
- **THEN** the entry is rejected with `permission-denied`, listed in the acknowledgement and never offered

#### Scenario: Undeclared template

- **WHEN** a controller registers a template id the manifest did not declare
- **THEN** the entry is rejected with `not-declared` and never enters the snapshot

#### Scenario: Snapshot exposes templates

- **WHEN** a plugin with two active templates is loaded
- **THEN** its host status names both labels and default file names without content

#### Scenario: Remove on stop

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** its templates leave the snapshot and the explorer and palette entries disappear

#### Scenario: Duplicate registration is idempotent

- **WHEN** a controller registers the same template id twice before completing
- **THEN** exactly one active template exists

#### Scenario: Workspace switch resets templates

- **WHEN** the user switches workspaces
- **THEN** no template from the previous workspace remains in the snapshot or the menu
