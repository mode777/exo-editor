# Spec Delta

## MODIFIED Requirements

### Requirement: Panel and content-view registration

The host SHALL record registered panel and content-view ids only after `plugin/register-complete`, SHALL expose them in the workspace-scoped snapshot with their resolved entry, placement and, for a content view, its optional declared companion panel, and SHALL remove them when the plugin stops.

#### Scenario: Registration activates on completion

- **WHEN** a controller registers a panel or content view but has not sent `plugin/register-complete`
- **THEN** no view entry is active for it

#### Scenario: Subset registration

- **WHEN** a manifest declares three panels and the controller registers one
- **THEN** only that panel is active and the other two remain available but unregistered

#### Scenario: Undeclared id

- **WHEN** a controller registers a panel or content-view id the manifest did not declare
- **THEN** the entry is rejected with `not-declared`, listed in the acknowledgement and never enters the snapshot

#### Scenario: Snapshot exposes view surfaces

- **WHEN** a plugin with a primary panel and a content view is active
- **THEN** the host snapshot names the panel, its primary location and entry, and the content view, its title and entry, without page content

#### Scenario: Snapshot preserves a companion association

- **WHEN** a registered content view declares a valid `companionPanel`
- **THEN** the host snapshot preserves that panel id on the content-view entry and does not add the panel frame or page content

#### Scenario: Stop removes view surfaces

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** none of its panel or content-view entries remain in the snapshot and no companion association survives

#### Scenario: Duplicate registration is idempotent

- **WHEN** a controller registers the same panel id twice before completing
- **THEN** exactly one active panel entry exists

#### Scenario: Registration order is stable

- **WHEN** two plugins register panels at different times
- **THEN** the snapshot and activity bar use declaration order and then registration order, independent of fetch or handshake timing
