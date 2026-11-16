# Spec Delta

## ADDED Requirements

### Requirement: Remote workspace entry point in the File menu

The File menu SHALL list Connect Remote Workspace… next to Open Folder…, whether
or not a workspace is open. Choosing it SHALL run the same command as the
command palette, the settings surface and the empty-explorer action, including
the dirty-document guard, and SHALL not introduce a second dialog or connection
path.

#### Scenario: File menu offers the connect entry

- **WHEN** the user opens the File menu with no workspace open or with a workspace open
- **THEN** Connect Remote Workspace… is listed next to Open Folder…

#### Scenario: Choosing the entry opens the connect dialog

- **WHEN** the user chooses Connect Remote Workspace… from the File menu
- **THEN** the existing remote-connect dialog opens, exactly as it does from the command palette or workspace settings

#### Scenario: Unsaved work is still guarded

- **WHEN** a dirty document is open and the user chooses Connect Remote Workspace… from the File menu
- **THEN** the shell resolves the dirty-document prompt before the connect dialog opens, and Cancel leaves the dialog closed and the document unchanged

#### Scenario: Every entry point shares one command

- **WHEN** the connect action runs from the File menu, the command palette, the settings surface or the empty explorer
- **THEN** each path invokes the same command and no entry point keeps separate connection state
