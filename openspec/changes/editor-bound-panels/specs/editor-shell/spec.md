# Spec Delta

## Purpose

Defines the shell workbench composition: regions, views, chrome, layout and
accessibility. This delta adds the bottom region as a plugin surface and tracks
the active file editor for view frames.

## ADDED Requirements

### Requirement: Plugin bottom panels

The shell SHALL enable the bottom region when at least one bottom panel is registered, SHALL add registered bottom panels to the workbench panel registry as tabs, SHALL show the active bottom tab through the normal bottom-panel visibility path, and SHALL disable the region when no bottom panel remains. It SHALL NOT add an activity-bar item or a secondary-view picker entry for a bottom panel. Bottom-region visibility, height and the active tab SHALL use the persisted layout session.

#### Scenario: Bottom region appears

- **WHEN** the first bottom panel registers
- **THEN** the bottom region becomes available with that panel as the active tab

#### Scenario: Multiple bottom panels as tabs

- **WHEN** several bottom panels are registered
- **THEN** the bottom region shows one tab per panel in declaration and registration order, and switching tabs hides the previous frame without disposal

#### Scenario: Inactive bottom tab stays unmounted

- **WHEN** the bottom region shows a tab that is not active
- **THEN** no iframe is created for that tab until it becomes active

#### Scenario: Close and reopen the region

- **WHEN** the user closes the bottom region and later reopens it
- **THEN** the active tab is shown again without a new handshake

#### Scenario: All bottom panels removed

- **WHEN** no bottom panel remains registered
- **THEN** the bottom region is disabled and its tabs disappear

#### Scenario: No activity bar or picker entry

- **WHEN** a bottom panel is registered
- **THEN** it adds no activity-bar item and no secondary-view picker entry

#### Scenario: Panel request controls the bottom region

- **WHEN** an active frame sends `plugin/request-panel` for its own bottom panel
- **THEN** `show` reveals the region on that tab, `hide` closes the region only when that tab is active and visible, and `toggle` uses the same rule

#### Scenario: Layout survives reload

- **WHEN** the user resizes the bottom region or selects another bottom tab and reloads
- **THEN** the bottom visibility, height and active tab are restored within the session

#### Scenario: Workspace switch resets the bottom surface

- **WHEN** the workspace switches
- **THEN** every bottom-panel frame is disposed and no tab from the previous workspace remains

### Requirement: Active editor tracking in the workbench

The shell SHALL derive the active editor from the active tab and mounted handler frames, SHALL advertise it only for a file handled by an active editor of the same plugin identity, and SHALL clear it for a shell text file, a content view, another plugin's editor or no tab. It SHALL update the context when those inputs change and SHALL NOT infer an editor from iframe visibility or the set of open tabs.

#### Scenario: Two editor tabs follow the active tab

- **WHEN** two files handled by one plugin are open and the user switches between their tabs
- **THEN** the shell advertises the active tab's editor and not the hidden tab's editor

#### Scenario: Handler becomes ready after the tab

- **WHEN** the active file tab's handler completes its handshake after the tab was activated
- **THEN** the shell publishes the active-editor context at that point, not while the handler is mounting

#### Scenario: Non-editor surface clears the context

- **WHEN** the active tab is a shell text file, a content view or no tab
- **THEN** the shell advertises no active editor

#### Scenario: Another plugin's editor clears the context

- **WHEN** the active tab is a file handled by another plugin
- **THEN** the shell advertises no active editor for this plugin

#### Scenario: Rename updates the path

- **WHEN** the active file handled by a plugin is renamed
- **THEN** the shell advertises the new path with the same editor instance id

#### Scenario: Failure or removal clears the context

- **WHEN** the active handler fails, is disposed or its plugin stops
- **THEN** the shell advertises no active editor and does not reuse the old instance id

#### Scenario: Workspace switch clears the context

- **WHEN** the workspace switches
- **THEN** the new workspace starts with no active-editor context from the previous one

#### Scenario: No content inference

- **WHEN** the shell derives the active editor
- **THEN** it reads only the tab, document surface, plugin identity and handler instance id, never file bytes or content

## MODIFIED Requirements

### Requirement: Plugin view chrome and accessibility

Plugin panel, bottom-panel and content-view chrome SHALL be shell-owned: titles, tabs, close controls, plugin names, notices and errors. The iframe SHALL have an accessible name, the activity item SHALL have a title, the secondary picker SHALL be keyboard operable, the bottom tabs SHALL be keyboard operable, and the surfaces SHALL meet the shell's accessibility requirements.

#### Scenario: Panel accessible name

- **WHEN** a panel is displayed
- **THEN** its iframe has an accessible name naming the plugin and the view, and the side-bar header or bottom tab exposes the view title

#### Scenario: Activity item title

- **WHEN** a primary panel's icon is rendered
- **THEN** its accessible title includes the plugin name and the view title

#### Scenario: Bottom tab names the plugin

- **WHEN** a bottom panel tab is rendered
- **THEN** its title includes the panel title and the plugin name and is operated through the shell-owned tab strip

#### Scenario: Secondary picker keyboard operation

- **WHEN** the user opens the Select View picker from the keyboard
- **THEN** focus moves into it, arrow keys move the selection, Enter switches views and Escape closes it and restores focus

#### Scenario: Automated scan

- **WHEN** a panel, bottom tab, content tab, activity item and secondary picker are rendered and scanned
- **THEN** no violation is reported for an Exo-owned node

#### Scenario: No plugin HTML in chrome

- **WHEN** a plugin-supplied title, icon name or view id is rendered
- **THEN** the shell treats it as text or a known Codicon name and never injects plugin HTML into its chrome

### Requirement: Lazy plugin view surfaces and budgets

The shell SHALL not mount a panel frame before its first reveal, SHALL not create a content-view frame before its tab opens, SHALL not mount an inactive bottom-panel tab, SHALL keep hidden frames alive without a new handshake, and SHALL include view surfaces, including bottom panels, in the recorded runtime performance budget.

#### Scenario: Lazy panel

- **WHEN** a plugin registers a panel and the user never opens it
- **THEN** no view frame is created and no plugin page is requested

#### Scenario: Lazy bottom panel

- **WHEN** a bottom panel is registered but its tab is not active
- **THEN** no view frame is created until the tab is revealed

#### Scenario: Re-reveal without handshake

- **WHEN** a panel is hidden and shown again
- **THEN** the same frame is displayed without a second `shell/init`

#### Scenario: Content frame on open

- **WHEN** a content-view tab is opened
- **THEN** its frame is created then, not at registration time

#### Scenario: View budget

- **WHEN** the reference panel, bottom panel and content view are opened on the deployed shell
- **THEN** their startup is measured against the recorded budget and a miss blocks release unless accepted in `docs/performance.md`
