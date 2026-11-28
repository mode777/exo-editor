# Spec Delta

## ADDED Requirements

### Requirement: Shell-triggered undo and redo

The reference plugin SHALL apply `shell/undo` and `shell/redo` to the Monaco
model through Monaco's own history, SHALL keep its native in-frame Ctrl/Cmd+Z
and redo handling, SHALL report dirty state from the resulting model, and SHALL
NOT construct content, request a save or change the saved version for either
intent.

#### Scenario: Shell undo restores the previous model state

- **WHEN** the shell sends `shell/undo` after a model edit
- **THEN** Monaco's history restores the previous text and the plugin reports the resulting dirty state

#### Scenario: Undo back to the saved text is clean

- **WHEN** the shell sends `shell/undo` and the model returns to the saved text
- **THEN** the plugin reports `plugin/dirty` with `false` without writing the file

#### Scenario: Shell redo reapplies the edit

- **WHEN** the shell sends `shell/redo` after an undo
- **THEN** Monaco's redo stack reapplies the edit and the plugin reports dirty again

#### Scenario: In-frame shortcuts stay native

- **WHEN** the user presses Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y while Monaco owns focus
- **THEN** Monaco handles the shortcut through its own history and the plugin sends no save request

#### Scenario: Empty history is a no-op

- **WHEN** the shell sends an undo or redo intent with no matching Monaco history entry
- **THEN** the model text and dirty state are unchanged and the plugin sends no content

#### Scenario: Read-only editor does not mutate

- **WHEN** the plugin has no write capability and receives an undo or redo intent
- **THEN** the model stays read-only, no content request is made and the dirty state does not change
