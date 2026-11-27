# Spec Delta

## MODIFIED Requirements

### Requirement: Content-view companion panels

The shell SHALL reveal a content view's declared companion panels in their declared regions when the view opens or its tab becomes active, and SHALL hide each panel when the active tab moves to a surface that does not declare it, and when the last open instance closes. Visibility SHALL be derived from the active tab and open instances, an unregistered or missing companion SHALL be skipped without blocking the view, and a manual hide SHALL remain until the next open or focus.

#### Scenario: Opening a content view reveals its companion

- **WHEN** a content view with two companion panels opens and both panels are registered
- **THEN** the shell reveals and activates each panel in its declared region and mounts each lazily like any other panel

#### Scenario: Focusing an existing instance reveals again

- **WHEN** a content view is opened again with the same instance key or its tab becomes active
- **THEN** the shell reveals and activates its companions without creating a second frame for any panel

#### Scenario: Active tab leaves the content view

- **WHEN** the active tab moves from a content view with companions to a surface that declares none of them
- **THEN** the shell hides each previous companion without disposing any panel frame

#### Scenario: Active tab keeps a shared companion

- **WHEN** the active tab moves to another surface that declares one of the previous companions
- **THEN** the shell keeps that panel visible and hides only the companions the new surface does not declare

#### Scenario: Multiple instances share a companion

- **WHEN** two open content-view instances declare the same companion panel and the user switches between their tabs
- **THEN** the companion panel stays visible and follows the active instance

#### Scenario: Last matching instance closes

- **WHEN** the last open content view that declares a companion panel closes through a tab close, close-all, plugin removal or view-pool disposal
- **THEN** the shell hides that panel without disposing the panel frame

#### Scenario: Unregistered companion is skipped

- **WHEN** a content view declares a companion panel that is not registered in the current session
- **THEN** the content view opens normally and the shell reveals that panel nowhere

#### Scenario: Missing or invalid companion is rejected early

- **WHEN** a manifest names an unknown panel, an invalid id, an empty list or a duplicate location as a companion
- **THEN** manifest validation fails before the content view can be registered or opened

#### Scenario: Manual hide is respected

- **WHEN** the user hides a companion panel while its content view remains open
- **THEN** the shell leaves it hidden until the content view is opened or focused again

#### Scenario: Another panel is active on close

- **WHEN** the user activates a different panel in the same region and then the last content view that declared the companion closes
- **THEN** the shell leaves the user's other panel and the region unchanged

#### Scenario: Manual picker selection is ordinary

- **WHEN** the user selects a companion panel from a shell picker or palette
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

## ADDED Requirements

### Requirement: File-editor companion panels

The shell SHALL reveal a matched file-editor contribution's declared companion panels when that editor's tab is active and its handler is active, and SHALL hide them when the active tab moves to a surface that does not declare that panel or the handler clears. A mounting, failed or background handler SHALL NOT reveal a companion. Visibility SHALL be derived from the active tab and handler state.

#### Scenario: Active editor reveals companions

- **WHEN** a file tab handled by a contribution with companions becomes active and the handler completes its handshake
- **THEN** the shell reveals each companion in its declared region without a plugin request

#### Scenario: Mounting handler does not reveal

- **WHEN** the active file tab matches a companion-bearing contribution but the handler is still mounting
- **THEN** no companion is revealed until the handler becomes active

#### Scenario: Failed handler does not reveal

- **WHEN** the active file tab's handler fails to load or halts before becoming active
- **THEN** the shell reveals no companion for that contribution

#### Scenario: Background editor does not reveal

- **WHEN** a handler becomes active for a file tab that is not the active tab
- **THEN** the shell does not reveal that contribution's companions

#### Scenario: Active file switches to another contribution

- **WHEN** the active tab moves between two files whose contributions declare different companions
- **THEN** the shell hides the first contribution's companions and reveals the second's

#### Scenario: Same contribution keeps companions

- **WHEN** the active tab moves between two files handled by the same contribution
- **THEN** the declared companions stay visible without a close and reopen

#### Scenario: Active editor clears

- **WHEN** the active tab moves to a shell text file, a content view, another plugin's editor or no tab, or the handler closes or fails
- **THEN** the shell hides the previous editor's companions without disposing their frames

#### Scenario: Editor companion shares a panel

- **WHEN** an active file editor and the next active surface both declare the same companion panel
- **THEN** the shell keeps that panel visible and hides only the other companions

### Requirement: Surface companion visibility rules

The shell SHALL apply one visibility path to all companion panels: reveal a panel through the normal region visibility action, hide it only when it is the active visible panel in its region, keep hidden frames mounted without a new handshake, and dispose them only with the plugin or workspace. A manual hide SHALL remain until the surface is opened or focused again, and a user-selected other panel SHALL not be closed.

#### Scenario: Primary companion

- **WHEN** a content view or active file editor declares a registered primary companion
- **THEN** the shell makes the primary side bar visible on that panel without changing the document tab strip

#### Scenario: Bottom companion

- **WHEN** a content view or active file editor declares a registered bottom companion
- **THEN** the shell opens the bottom region on that panel's tab without changing the document tab strip

#### Scenario: Secondary companion

- **WHEN** a content view or active file editor declares a registered secondary companion
- **THEN** the shell makes the secondary side bar visible on that panel

#### Scenario: Manual hide survives unrelated updates

- **WHEN** the user hides a companion and the active surface stays the same
- **THEN** the shell does not reopen it on dirty, save, theme or other unrelated changes

#### Scenario: Refocus reveals again

- **WHEN** the user leaves the surface and returns to it
- **THEN** the shell reveals the declared companions again through the normal path

#### Scenario: User-selected panel is respected

- **WHEN** the user activates a different panel in a region and the surface then loses or regains the tab
- **THEN** the shell does not close the user's panel when hiding and uses the normal show action when revealing

#### Scenario: Hidden frame is retained

- **WHEN** a companion hides and is revealed again
- **THEN** the shell reuses the existing frame without a new handshake, unless the plugin or workspace was removed

#### Scenario: Workspace switch resets companions

- **WHEN** the workspace switches
- **THEN** the shell hides every companion and discards the previous workspace's companion state before the new workspace is usable

#### Scenario: No new message or event

- **WHEN** the shell reveals or hides a companion
- **THEN** it sends no plugin message, shell event, heartbeat or timeout for the companion change and adds no protocol topic
