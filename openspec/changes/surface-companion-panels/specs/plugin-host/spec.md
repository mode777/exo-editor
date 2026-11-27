# Spec Delta

## MODIFIED Requirements

### Requirement: Panel and content-view registration

The host SHALL record registered editor, panel and content-view ids only after `plugin/register-complete`, SHALL expose them in the workspace-scoped snapshot with their resolved entry and placement, including `primary`, `secondary` or `bottom`, SHALL expose each registered content view's and file editor's declared companion panel ids and locations, and SHALL remove them when the plugin stops.

#### Scenario: Registration activates on completion

- **WHEN** a controller registers an editor, panel or content view but has not sent `plugin/register-complete`
- **THEN** no entry is active for it

#### Scenario: Subset registration

- **WHEN** a manifest declares three panels and the controller registers one
- **THEN** only that panel is active and the other two remain available but unregistered

#### Scenario: Undeclared id

- **WHEN** a controller registers an editor, panel or content-view id the manifest did not declare
- **THEN** the entry is rejected with `not-declared`, listed in the acknowledgement and never enters the snapshot

#### Scenario: Snapshot exposes view surfaces

- **WHEN** a plugin with a primary panel and a content view is active
- **THEN** the host snapshot names the panel, its primary location and entry, and the content view, its title and entry, without page content

#### Scenario: Snapshot preserves a bottom panel

- **WHEN** a plugin registers a bottom panel
- **THEN** the snapshot names the panel, its `bottom` location and its resolved entry, and the workbench can derive the bottom tab from it

#### Scenario: Snapshot preserves a companion association

- **WHEN** a registered content view or file editor declares valid companions in any region
- **THEN** the host snapshot preserves the panel ids and their locations on the entry and does not add the panel frame or page content

#### Scenario: Stop removes view surfaces

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** none of its editor, panel or content-view entries remain in the snapshot and no companion association survives

#### Scenario: Duplicate registration is idempotent

- **WHEN** a controller registers the same panel id twice before completing
- **THEN** exactly one active panel entry exists

#### Scenario: Registration order is stable

- **WHEN** two plugins register panels at different times
- **THEN** the snapshot and activity bar or bottom tabs use declaration order and then registration order, independent of fetch or handshake timing
