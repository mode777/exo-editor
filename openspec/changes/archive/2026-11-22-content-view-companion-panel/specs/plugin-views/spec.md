# Spec Delta

## ADDED Requirements

### Requirement: Content-view companion panels

The shell SHALL reveal a registered content view's declared `companionPanel` in the secondary side bar when the view opens or is focused, and SHALL hide it when the last open instance of that content view closes. Visibility SHALL be derived from the open content-view instances, an unregistered or missing companion SHALL be skipped without blocking the content view, and a manual hide SHALL remain until the next open or focus.

#### Scenario: Opening a content view reveals its companion

- **WHEN** a content view with `companionPanel` opens and that panel is registered as a secondary panel
- **THEN** the shell activates the secondary side bar on that panel and mounts it lazily like any other secondary panel

#### Scenario: Focusing an existing instance reveals again

- **WHEN** a content view is opened again with the same instance key or its tab becomes active
- **THEN** the shell reveals and activates its companion panel without creating a second panel frame

#### Scenario: Multiple instances share a companion

- **WHEN** two open content-view instances declare the same companion panel
- **THEN** closing one instance leaves the companion panel visible while the other instance remains open

#### Scenario: Last matching instance closes

- **WHEN** the last open content view that declares a companion panel closes through a tab close, close-all, plugin removal or view-pool disposal
- **THEN** the shell hides that secondary panel without disposing the panel frame

#### Scenario: Unregistered companion is skipped

- **WHEN** a content view declares a companion panel that is not registered in the current session
- **THEN** the content view opens normally and the shell reveals no panel

#### Scenario: Missing or invalid companion is rejected early

- **WHEN** a manifest names an unknown panel, a primary panel or an invalid id as `companionPanel`
- **THEN** manifest validation fails before the content view can be registered or opened

#### Scenario: Manual hide is respected

- **WHEN** the user hides the companion panel while its content view remains open
- **THEN** the shell leaves it hidden until the content view is opened or focused again

#### Scenario: Another panel is active on close

- **WHEN** the user activates a different secondary panel and then closes the last content view that declared the companion
- **THEN** the shell leaves the user's other panel and the secondary side bar unchanged

#### Scenario: Manual picker selection is ordinary

- **WHEN** the user selects the companion panel from the secondary-view picker or palette
- **THEN** the shell shows it as an ordinary panel and does not associate that manual open with a content-view instance

#### Scenario: Request-panel semantics are unchanged

- **WHEN** a frame sends `plugin/request-panel` for a panel that is also a companion
- **THEN** the shell applies the existing show, hide and toggle semantics and does not treat the request as a content-view lifecycle change

#### Scenario: Plugin removal hides the companion

- **WHEN** the content view's plugin is disabled, removed or revoked
- **THEN** the shell closes its content views, hides an orphaned companion panel and disposes the panel frame with the plugin

#### Scenario: Workspace switch hides the companion

- **WHEN** the workspace switches while a content view with a visible companion is open
- **THEN** the shell hides the companion and tears down the previous workspace's view state before the new workspace is usable

#### Scenario: No polling or lifecycle event

- **WHEN** a content-view tab opens, is focused or closes
- **THEN** the shell derives the companion change itself and sends the plugin no new message, event, heartbeat or timeout
