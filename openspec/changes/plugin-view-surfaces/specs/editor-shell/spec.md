# Spec Delta

## MODIFIED Requirements

### Requirement: Workspace switch resets workspace-scoped state

Loading a different workspace SHALL reset open tabs including plugin content-view tabs, plugin registrations, handler and view sessions, watchers, caches, event subscriptions and workspace-scoped settings, while retaining global layout and theme preferences. A callback belonging to a released workspace SHALL NOT be able to mutate shell state.

#### Scenario: Nothing survives a switch

- **WHEN** a user switches from workspace A to workspace B
- **THEN** no tab, content view, registration, handler or view session, watcher, cached file or plugin setting from A is observable in B

#### Scenario: Late callback is dropped

- **WHEN** a workspace operation or watcher callback from A resolves after B is ready
- **THEN** the shell ignores it and B's state is unchanged

#### Scenario: View frames are disposed before release

- **WHEN** the workspace switches while a panel or content view is mounted
- **THEN** its frame is disposed before the old session is released and no content-view tab from A remains

## ADDED Requirements

### Requirement: Plugin primary panels and activity bar

The shell SHALL derive `config.activityBar.items`, `config.primarySideBar.views` and the primary view registry from active plugin registrations, SHALL show the explorer first and then primary panels in declaration and registration order, and SHALL switch to a panel on activation without forking the workbench preset.

#### Scenario: Primary panel becomes an activity item

- **WHEN** a plugin registers a declared primary panel
- **THEN** the activity bar shows its icon and title after the explorer and activating it opens that panel

#### Scenario: Activity item switches views

- **WHEN** the user activates a different primary panel
- **THEN** the side bar shows that panel and the previous panel is hidden without disposal

#### Scenario: Removal falls back

- **WHEN** the active primary panel is unregistered or its plugin stops
- **THEN** the shell shows the explorer and removes the activity item

#### Scenario: Dynamic configuration

- **WHEN** the plugin host snapshot changes
- **THEN** the shell recomputes the activity items and primary views from the snapshot without reloading the page or patching the preset

#### Scenario: No plugin panels

- **WHEN** no plugin contributes a primary panel
- **THEN** the activity bar contains the shell's explorer and settings items exactly as before

### Requirement: Plugin secondary panels

The shell SHALL enable the secondary side bar when at least one secondary panel is registered, SHALL expose those panels through a shell-owned picker and command-palette entries, and SHALL remember the active secondary view within the session.

#### Scenario: Secondary region appears

- **WHEN** the first secondary panel registers
- **THEN** the secondary side bar becomes available with that panel as the active view

#### Scenario: Show View picker

- **WHEN** more than one secondary panel is registered
- **THEN** the secondary header offers a Select View action and the palette lists every secondary panel with its plugin name

#### Scenario: Switch secondary view

- **WHEN** the user chooses a different secondary panel
- **THEN** the region shows that panel, hides the previous frame without disposal and keeps the choice for the session

#### Scenario: All secondary panels removed

- **WHEN** no secondary panel remains registered
- **THEN** the secondary region is hidden and its picker and palette entries disappear

#### Scenario: Activity bar is not overloaded

- **WHEN** a secondary panel is registered
- **THEN** it does not add an activity-bar item, because the preset activity bar activates primary views only

### Requirement: Plugin content-view tabs

The shell SHALL open a content view as a read-only tab in the document area, SHALL close and dispose it like a document tab without a dirty prompt, and SHALL keep file tabs and content-view tabs distinct.

#### Scenario: Content view opens

- **WHEN** a content view is opened from the palette or by a plugin intent
- **THEN** a tab appears with the view title and the frame is displayed in the document body

#### Scenario: Tab switch hides the frame

- **WHEN** the user switches from a content-view tab to a file tab and back
- **THEN** the content frame is hidden without disposal and the same session is shown on return

#### Scenario: Close disposes

- **WHEN** the user closes a content-view tab
- **THEN** the tab is removed, the frame is disposed and no dirty prompt appears because the view is read-only

#### Scenario: No save or dirty state

- **WHEN** a content-view tab is active
- **THEN** Save is not offered, the tab has no dirty indicator and the close guard does not treat it as a document

#### Scenario: Content tabs are not files

- **WHEN** the shell computes the active document path or the quick-open file list
- **THEN** a content-view tab contributes no path and no file entry

#### Scenario: Close all and workspace switch

- **WHEN** the user closes all tabs or switches workspaces
- **THEN** every content-view tab is removed and its frame disposed

### Requirement: Plugin view chrome and accessibility

Plugin panel and content-view chrome SHALL be shell-owned: titles, tabs, close controls, plugin names, notices and errors. The iframe SHALL have an accessible name, the activity item SHALL have a title, the secondary picker SHALL be keyboard operable, and the surfaces SHALL meet the shell's accessibility requirements.

#### Scenario: Panel accessible name

- **WHEN** a panel is displayed
- **THEN** its iframe has an accessible name naming the plugin and the view, and the side-bar header exposes the view title

#### Scenario: Activity item title

- **WHEN** a primary panel's icon is rendered
- **THEN** its accessible title includes the plugin name and the view title

#### Scenario: Secondary picker keyboard operation

- **WHEN** the user opens the Select View picker from the keyboard
- **THEN** focus moves into it, arrow keys move the selection, Enter switches views and Escape closes it and restores focus

#### Scenario: Automated scan

- **WHEN** a panel, content tab, activity item and secondary picker are rendered and scanned
- **THEN** no violation is reported for an Exo-owned node

#### Scenario: No plugin HTML in chrome

- **WHEN** a plugin-supplied title, icon name or view id is rendered
- **THEN** the shell treats it as text or a known Codicon name and never injects plugin HTML into its chrome

### Requirement: Lazy plugin view surfaces and budgets

The shell SHALL not mount a panel frame before its first reveal, SHALL not create a content-view frame before its tab opens, SHALL keep hidden frames alive without a new handshake, and SHALL include view surfaces in the recorded runtime performance budget.

#### Scenario: Lazy panel

- **WHEN** a plugin registers a panel and the user never opens it
- **THEN** no view frame is created and no plugin page is requested

#### Scenario: Re-reveal without handshake

- **WHEN** a panel is hidden and shown again
- **THEN** the same frame is displayed without a second `shell/init`

#### Scenario: Content frame on open

- **WHEN** a content-view tab is opened
- **THEN** its frame is created then, not at registration time

#### Scenario: View budget

- **WHEN** the reference panel and content view are opened on the deployed shell
- **THEN** their startup is measured against the recorded budget and a miss blocks release unless accepted in `docs/performance.md`
