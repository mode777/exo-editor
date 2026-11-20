# Spec Delta

## MODIFIED Requirements

### Requirement: Explorer reflects the active workspace

The explorer SHALL show a header naming the active workspace with only applicable action icons, list the active workspace lazily, update after shell-originated create, rename and delete, hide shell-only entries, and disable mutating actions when the session is not writable.

#### Scenario: Workspace header names the active workspace

- **WHEN** a workspace is ready
- **THEN** the explorer header shows the active descriptor's display name and the New File, New Folder, Refresh Explorer and Collapse Folders in Explorer actions, and the name follows a workspace switch or remote connection

#### Scenario: Header actions reflect applicability

- **WHEN** no directory is expanded or the workspace is read-only
- **THEN** Collapse Folders in Explorer is disabled with nothing to collapse, New File and New Folder are disabled while the session is not writable, and Refresh Explorer stays available while the workspace is ready

#### Scenario: Header twisty shows or hides the tree

- **WHEN** the user activates the workspace header's twisty control
- **THEN** the file tree rows are hidden or shown again without releasing the workspace, and the control reports its expanded state

#### Scenario: Directories expand and collapse

- **WHEN** the user clicks a directory row once
- **THEN** it is selected, its children are listed from the session, directories sort before files, and a second click removes the children from the visible tree

#### Scenario: A file row is still opened deliberately

- **WHEN** the user clicks a file row once
- **THEN** it is selected and no tab opens, while a double-click or Enter opens it in a tab

#### Scenario: Collapse folders

- **WHEN** the user invokes Collapse Folders in Explorer from the header, the View menu or the command palette
- **THEN** every expanded directory collapses and the visible tree keeps only the root's direct children

#### Scenario: Create, rename and delete

- **WHEN** the user creates a file or folder, renames an entry or deletes an entry
- **THEN** the session performs the operation and the explorer shows the resulting tree without a full reload

#### Scenario: Shell-only entries are not openable

- **WHEN** the workspace root contains `exo.json` or `/.exo`
- **THEN** neither is offered as an openable document, and `/exo.json` is not shown as a file the explorer can edit

#### Scenario: Read-only workspace disables mutation

- **WHEN** the session reports `writable: false`
- **THEN** new, rename and delete actions are disabled and the explorer explains that the workspace is read-only

#### Scenario: Focus refreshes visible directories

- **WHEN** the window regains focus and a visible directory changed outside the shell
- **THEN** the explorer re-lists that directory and shows the new entries
