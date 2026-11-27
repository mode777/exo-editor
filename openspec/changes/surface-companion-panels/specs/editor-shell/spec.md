# Spec Delta

## MODIFIED Requirements

### Requirement: Content-view companion panels in the workbench

The shell SHALL reveal declared companion panels in their primary, secondary or bottom regions when a content-view tab opens or is active, or when a file editor's tab is active and its handler is active. It SHALL hide a panel when the active surface no longer declares it, when the handler clears, or when the last content view closes, keeping panels shared with the next surface. It SHALL use the normal region visibility path and SHALL NOT change `plugin/request-panel`.

#### Scenario: Tab opens with a companion

- **WHEN** a content-view tab with a registered companion opens
- **THEN** the companion's region becomes visible with that panel active, without changing the document tab strip

#### Scenario: Returning to the tab reveals the companion

- **WHEN** the user switches from a file tab or another content-view tab back to a content view with a companion
- **THEN** the shell reveals and activates the companion again

#### Scenario: Close the last tab

- **WHEN** the user closes the last content-view tab that uses a companion and no other open surface uses it
- **THEN** the shell hides the companion panel and leaves the panel frame mounted for its next reveal

#### Scenario: Active file tab hides the companion

- **WHEN** the user switches from a content-view tab to a file tab or to a content view with another companion
- **THEN** the shell hides each previous companion that the new surface does not declare while leaving the panel frames mounted

#### Scenario: Shared companion follows the active tab

- **WHEN** two tabs use one companion and the user switches between them
- **THEN** the companion's region keeps showing the companion

#### Scenario: Closing the active shared tab

- **WHEN** two tabs use one companion, the user closes the active tab and the remaining tab is not active
- **THEN** the companion hides until that remaining tab becomes active

#### Scenario: Manual hide wins until refocus

- **WHEN** the user hides a companion while the content view stays active
- **THEN** the shell does not reopen it on unrelated updates, and only a later surface open or focus reveals it again

#### Scenario: Another panel is not dismissed

- **WHEN** the user selects a different view in a region and then closes the content view
- **THEN** the shell leaves the other panel visible and does not close the region

#### Scenario: Picker remains ordinary

- **WHEN** the user opens a view picker or a panel palette entry
- **THEN** the chosen panel is shown through the normal manual path and is not tracked as a surface companion

#### Scenario: Missing panel does not block the tab

- **WHEN** a companion panel is not registered or its plugin is no longer active
- **THEN** the content-view or editor tab still opens, renders its own state and shows no companion-related error

#### Scenario: Workspace reset

- **WHEN** the workspace switches while a companion is visible
- **THEN** the shell hides it along with the old tabs and restores no stale companion in the new workspace

#### Scenario: Active editor reveals companions

- **WHEN** a file tab handled by a contribution with companions becomes active and its handler completes the handshake
- **THEN** the shell reveals each companion in its declared region without user action or a plugin request

#### Scenario: Mounting editor does not reveal

- **WHEN** the active file tab matches a companion-bearing contribution but its handler is still mounting or has failed
- **THEN** the shell reveals no companion for that contribution

#### Scenario: File switch updates companions

- **WHEN** the active tab moves between two files whose contributions declare different companions
- **THEN** the shell hides the companions the new contribution does not declare and reveals the new ones

#### Scenario: Primary and bottom companions

- **WHEN** a surface declares a primary and a bottom companion
- **THEN** the shell opens the primary side bar on the primary panel and the bottom region on the bottom panel, leaving the document tab strip unchanged

#### Scenario: Reveal keeps keyboard focus

- **WHEN** a companion reveals automatically as a tab becomes active
- **THEN** keyboard focus stays on the tab or control the user was using and does not move into the panel iframe or its region chrome
