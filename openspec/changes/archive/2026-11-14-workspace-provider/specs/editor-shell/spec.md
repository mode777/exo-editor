# Spec Delta

## ADDED Requirements

### Requirement: Open a folder-backed workspace

The shell SHALL open one user-picked folder as the active workspace through the session, show its name and capabilities, and leave the current workspace untouched when the picker is cancelled. Without a folder picker it SHALL show an explicit unsupported state.

#### Scenario: Picked folder opens

- **WHEN** the user runs Open Folder and picks a directory
- **THEN** the explorer lists the selected root and the status bar shows the folder name

#### Scenario: Cancellation is silent

- **WHEN** the user cancels the directory picker
- **THEN** no error is reported and the previous workspace, if any, remains active

#### Scenario: Switching disposes the old workspace first

- **WHEN** a folder is picked while another workspace is open
- **THEN** the old session is disposed before the new tree renders and no tab from the old workspace remains

#### Scenario: Unsupported browser is explicit

- **WHEN** the browser has no directory picker
- **THEN** Open Folder explains the limitation and no fabricated workspace or file tree appears

#### Scenario: Picker failure is actionable

- **WHEN** the picker rejects with a permission or security failure
- **THEN** the shell reports an actionable message and does not change the active workspace

### Requirement: Restore the last workspace

The shell SHALL restore the last opened workspace after a reload from its persisted directory handle and SHALL present it read-only with an explicit restore-access action until write permission is granted in a user gesture.

#### Scenario: Silent restore with permission

- **WHEN** the page reloads and the stored handle still has read-write permission
- **THEN** the workspace restores with the same identity and writable capability without prompting

#### Scenario: Read-only restore without write permission

- **WHEN** the page reloads and write permission must be requested again
- **THEN** the workspace restores read-only, editing and mutation actions are disabled, and a banner offers Restore access

#### Scenario: Restore access requires a user gesture

- **WHEN** the user activates Restore access
- **THEN** the shell requests write permission from that action and enables editing only if it is granted

#### Scenario: Missing handle is cleared

- **WHEN** the stored handle is absent or the folder cannot be reopened
- **THEN** the shell clears the stored record, starts with no workspace, and explains why

### Requirement: Explorer reflects the active workspace

The explorer SHALL list the active workspace lazily, update after shell-originated create, rename and delete, hide shell-only entries, and disable mutating actions when the session is not writable.

#### Scenario: Directories expand and collapse

- **WHEN** the user expands a directory
- **THEN** its children are listed from the session, directories sort before files, and collapsing it removes the children from the visible tree

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

### Requirement: Explorer keyboard operation

The explorer SHALL be operable from the keyboard: moving between rows, expanding and collapsing, opening files, renaming and deleting, with focus kept on a valid row after the tree changes.

#### Scenario: Arrow keys move and expand

- **WHEN** the explorer has focus and the user presses Arrow Up, Arrow Down, Arrow Right or Arrow Left
- **THEN** focus moves to the adjacent row or expands and collapses the focused directory

#### Scenario: Enter opens or toggles

- **WHEN** the user presses Enter on a focused file or directory
- **THEN** the file opens in a tab or the directory toggles expansion

#### Scenario: Rename and delete from the keyboard

- **WHEN** the user presses F2 or Delete on a focused entry
- **THEN** rename starts inline or the delete confirmation opens, respectively

#### Scenario: Focus survives a tree change

- **WHEN** an entry is deleted or renamed
- **THEN** focus moves to a valid sibling or parent instead of being lost

### Requirement: Workspace commands

The shell SHALL expose Open Folder with or without a workspace and Save for the active text document, including command-palette entries, and SHALL omit actions that cannot apply instead of showing enabled no-ops.

#### Scenario: Open Folder is always available

- **WHEN** no workspace is open and the command palette is opened
- **THEN** Open Folder is listed and starts the folder picker

#### Scenario: Save targets the active document

- **WHEN** a dirty text document is active and the user runs Save
- **THEN** the document writes through the session and clears its dirty state on success

#### Scenario: Inapplicable actions are omitted

- **WHEN** no text document is active
- **THEN** Save is not offered as a runnable palette entry

### Requirement: Text documents open and save

The shell SHALL provide a text document surface that reads bytes through the session, edits decoded UTF-8, and saves the exact bytes with the loaded version as `ifVersion`. Editing state SHALL be owned by that surface, and no file handle SHALL reach it.

#### Scenario: Open a 1 MiB text file

- **WHEN** the user opens a 1 MiB UTF-8 text file
- **THEN** the tab shows the decoded content and the surface receives the path and bytes, not a file or directory handle

#### Scenario: Save round-trips exact bytes

- **WHEN** the user edits and saves a text document
- **THEN** the written bytes equal the edited content and the returned stat becomes the new loaded version

#### Scenario: Save uses the loaded version

- **WHEN** the file changed on disk after it was loaded
- **THEN** the save fails with `conflict`, the newer disk content remains, and the tab stays dirty

#### Scenario: Read failure is recoverable

- **WHEN** opening a file fails with `not-found` or `permission-denied`
- **THEN** the tab shows an actionable error with Retry and no empty document is presented as the file's content

### Requirement: Dirty documents are protected

The shell SHALL show a dirty indicator for an edited document, prompt with save, discard and cancel before closing or replacing a dirty tab, and warn on page unload while any document is dirty.

#### Scenario: Dirty indicator is visible

- **WHEN** the user changes a document's text
- **THEN** the tab shows a dirty indicator and the indicator clears only after a successful save or reload

#### Scenario: Closing a dirty tab prompts

- **WHEN** the user closes a dirty tab
- **THEN** the shell offers Save, Discard and Cancel and does not remove the tab until the choice resolves

#### Scenario: Cancel keeps the document

- **WHEN** the user chooses Cancel in the close prompt
- **THEN** the tab, content and dirty state are unchanged

#### Scenario: Save then close

- **WHEN** the user chooses Save in the close prompt and the save succeeds
- **THEN** the tab closes and the saved content remains on disk

#### Scenario: Discard closes without writing

- **WHEN** the user chooses Discard in the close prompt
- **THEN** the tab closes and no write reaches the provider

#### Scenario: Closing several dirty tabs is protected

- **WHEN** the user closes all tabs or another tab while more than one document is dirty
- **THEN** every dirty document is resolved by the prompt before any of them is removed

#### Scenario: Unload warns about unsaved work

- **WHEN** the page is reloaded or closed while a document is dirty
- **THEN** the browser receives a before-unload warning

### Requirement: External changes are visible

The shell SHALL show an external-change notice when a refresh finds an open document's version changed or the file deleted, and SHALL preserve local edits until the user chooses to reload or keep them.

#### Scenario: Clean document offers reload

- **WHEN** a clean open document changes on disk
- **THEN** the document shows an external-change notice with a Reload action and does not discard the tab

#### Scenario: Dirty document keeps local edits

- **WHEN** a dirty open document changes on disk
- **THEN** the shell keeps the local edits, shows the notice, and a save surfaces `conflict` instead of overwriting

#### Scenario: Deleted file is reported

- **WHEN** an open document is deleted outside the shell
- **THEN** the tab shows a deleted-file notice and no save recreates it

#### Scenario: Late refresh cannot mutate the next workspace

- **WHEN** a refresh from a released workspace resolves after a switch
- **THEN** the shell ignores it and the new workspace state is unchanged

### Requirement: Unsupported document content has no editor

The shell SHALL present an explicit no-editor state for binary, undecodable or oversized files and SHALL never write them through the text surface.

#### Scenario: Binary file shows no editor

- **WHEN** a file contains NUL bytes in its initial sample
- **THEN** the tab shows a binary/no-editor state with the path and size

#### Scenario: Oversized file shows no editor

- **WHEN** a file exceeds the shell's text read limit
- **THEN** the tab shows a too-large state naming the limit and no content is loaded

#### Scenario: Undecodable file shows no editor

- **WHEN** a file cannot be decoded as UTF-8
- **THEN** the tab shows the no-editor state instead of replacement characters

#### Scenario: No-editor files are never written

- **WHEN** a binary or oversized file is open
- **THEN** no save action is offered for it

### Requirement: Open documents follow rename and delete

The shell SHALL keep an open document attached to its file across rename and SHALL close it on delete without allowing a later save to recreate the file.

#### Scenario: Rename updates the open tab

- **WHEN** the user renames the open file
- **THEN** the tab title and path update to the new name and no second tab appears

#### Scenario: Dirty document saves to the new path

- **WHEN** a dirty open document is renamed
- **THEN** its next save writes to the new path with the move's returned version

#### Scenario: Deleting the open file closes its tab

- **WHEN** the user deletes the open file and the document is clean
- **THEN** the tab closes and the document state is dropped

#### Scenario: Deleting a dirty file is confirmed

- **WHEN** the user deletes the open file and the document is dirty
- **THEN** the shell confirms the loss before deleting, and a confirmed delete removes the tab

#### Scenario: Delete cancels an in-flight save

- **WHEN** the open file is deleted while its save is in flight
- **THEN** the save does not recreate the file and the tab does not reappear

### Requirement: Workspace failures are scoped

The shell SHALL report workspace failures in the surface they affect, naming the workspace or path, and SHALL clear them when the workspace changes; it SHALL not use a global notification that obscures which folder failed.

#### Scenario: Directory listing failure is inline

- **WHEN** listing a directory fails
- **THEN** that directory shows the failure and a Retry action while the rest of the explorer stays usable

#### Scenario: Save failure stays with the document

- **WHEN** a save fails
- **THEN** the document shows the failure, keeps its content and dirty state, and the error does not replace the explorer

#### Scenario: Permission loss is a workspace banner

- **WHEN** the session reports `permission-denied` for workspace access
- **THEN** a banner on the workspace surface explains the lost permission and offers the recovery action

#### Scenario: Switching clears the previous failure

- **WHEN** the user switches workspaces
- **THEN** no error banner or message from the previous workspace remains
