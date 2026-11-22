# Spec Delta

## ADDED Requirements

### Requirement: Content-view companion panels in the workbench

The shell SHALL reveal a content view's declared companion panel in the secondary side bar when its tab opens or becomes the active tab, SHALL hide that panel when the last tab for the view closes, and SHALL keep a manual hide or a user-selected other secondary view until the next content-view open or focus. The behavior SHALL use the normal secondary-panel visibility path and SHALL NOT change `plugin/request-panel`.

#### Scenario: Tab opens with a companion

- **WHEN** a content-view tab with a registered companion opens
- **THEN** the secondary side bar becomes visible with that panel active, without changing the document tab strip

#### Scenario: Returning to the tab reveals the companion

- **WHEN** the user switches from a file tab or another content-view tab back to a content view with a companion
- **THEN** the shell reveals and activates the companion again

#### Scenario: Close the last tab

- **WHEN** the user closes the last content-view tab that uses a companion and no other open view uses it
- **THEN** the shell hides the companion panel and leaves the panel frame mounted for its next reveal

#### Scenario: Shared companion stays visible

- **WHEN** two content-view tabs use one companion and the user closes one
- **THEN** the secondary side bar keeps showing the companion for the remaining tab

#### Scenario: Manual hide wins until refocus

- **WHEN** the user hides the secondary side bar while the content view stays active
- **THEN** the shell does not reopen it on unrelated updates, and only a later content-view open or focus reveals it again

#### Scenario: Another panel is not dismissed

- **WHEN** the user selects a different secondary view and then closes the content view
- **THEN** the shell leaves the other panel visible and does not close the side bar

#### Scenario: Picker remains ordinary

- **WHEN** the user opens the Select View picker or a secondary-panel palette entry
- **THEN** the chosen panel is shown through the normal manual path and is not tracked as a content-view companion

#### Scenario: Missing panel does not block the tab

- **WHEN** the companion panel is not registered or its plugin is no longer active
- **THEN** the content-view tab still opens, renders its own state and shows no companion-related error

#### Scenario: Workspace reset

- **WHEN** the workspace switches while a companion is visible
- **THEN** the shell hides it along with the old content-view tabs and restores no stale companion in the new workspace
