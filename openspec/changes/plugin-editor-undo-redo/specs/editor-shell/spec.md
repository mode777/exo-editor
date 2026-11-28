# Spec Delta

## ADDED Requirements

### Requirement: Undo and redo command surfaces

The shell SHALL expose Undo and Redo as Edit-menu entries, palette commands and
keyboard shortcuts for the active writable plugin-backed document. It SHALL list
the palette commands only while that document exists, SHALL keep the menu entries
stable and no-op outside that case, and SHALL label the shortcuts consistently
with the command registry. These commands SHALL be shell-owned and SHALL NOT be
listed as plugin-contributed commands.

#### Scenario: Edit menu exposes Undo and Redo

- **WHEN** the user opens the Edit menu
- **THEN** it shows Undo and Redo with their shortcut labels and invokes the shell commands when chosen

#### Scenario: Palette lists the commands for a plugin document

- **WHEN** an active writable plugin-backed document exists and the user opens the command palette
- **THEN** Undo and Redo are listed under the shell's Edit category with the same shortcuts

#### Scenario: Palette hides the commands elsewhere

- **WHEN** the active document is a shell text file, a content view, a settings surface, a read-only plugin document or no tab
- **THEN** the palette lists no shell Undo or Redo command and the menu entries perform no action

#### Scenario: Keyboard invokes Undo

- **WHEN** the active document is a writable plugin editor and the user presses Ctrl/Cmd+Z
- **THEN** the shell invokes its Undo command once

#### Scenario: Keyboard invokes Redo

- **WHEN** the active document is a writable plugin editor and the user presses Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y
- **THEN** the shell invokes its Redo command once

#### Scenario: Menu entries are keyboard accessible

- **WHEN** the user opens the Edit menu with the keyboard
- **THEN** Undo and Redo are reachable, announced with their labels, and Escape closes the menu without invoking them

#### Scenario: Workspace changes reset the surface

- **WHEN** the workspace switches or the active plugin document closes
- **THEN** the palette no longer lists Undo or Redo and a later invocation sends nothing to the previous workspace

### Requirement: Undo routing stays with the active handler

The shell SHALL route undo and redo only to the active, writable handler that
owns the active plugin document. It SHALL NOT keep an undo history or
`canUndo`/`canRedo` tab state, SHALL leave the shell textarea on native undo,
SHALL NOT intercept the shortcut from editable shell controls, and SHALL NOT send
a duplicate intent for a key event it cannot observe inside a plugin iframe.

#### Scenario: Hidden handler is reachable

- **WHEN** the active plugin-backed document uses a hidden handler and the user invokes Undo from the menu or shortcut
- **THEN** the shell sends the intent to that handler even though no iframe can receive focus

#### Scenario: Tab switch follows the active handler

- **WHEN** two plugin-backed documents are open and the user switches tabs before invoking Undo
- **THEN** the shell sends the intent only to the handler of the newly active document

#### Scenario: Mounting or failed handler receives nothing

- **WHEN** the active document's handler is still mounting, has failed or no longer has an active session
- **THEN** the shell sends no undo or redo intent

#### Scenario: Read-only document receives nothing

- **WHEN** the active plugin document is read-only, the plugin lacks write capability or the workspace session is not writable
- **THEN** the shell sends no intent and offers no content mutation

#### Scenario: Shell text keeps native undo

- **WHEN** the active document is the shell text surface and the user presses Ctrl/Cmd+Z while the textarea is focused
- **THEN** the browser's native undo applies and the shell sends no plugin intent

#### Scenario: Shell inputs keep their own undo

- **WHEN** focus is in a shell input, textarea or other editable control and the user presses an undo or redo shortcut
- **THEN** the shell does not run its plugin Undo or Redo command

#### Scenario: Modal dialog owns the shortcut

- **WHEN** a shell modal dialog is open and the user presses an undo or redo shortcut
- **THEN** the shell sends no plugin intent and leaves the dialog's own handling in place

#### Scenario: Visible frame keys are not duplicated

- **WHEN** a visible plugin iframe owns keyboard focus
- **THEN** its own key handling applies, the shell window handler does not observe the event and no second intent is sent

#### Scenario: No can-undo tab state

- **WHEN** a plugin-backed document is open
- **THEN** the tab and document state carry only the plugin-reported dirty flag, with no shell-tracked undo availability, history depth or redo state
