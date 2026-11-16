# Spec Delta

## MODIFIED Requirements

### Requirement: Editing, saving and external changes

The reference plugin SHALL report dirty state when the model changes, SHALL answer
the shell's save request with the current model text, SHALL request the shell's
save path from an in-frame Ctrl/Cmd+S when the document is dirty and writable,
SHALL clear its dirty state only after a successful save when no later edit
occurred, and SHALL react to an external change without silently overwriting the
newer content.

#### Scenario: Edit marks the tab dirty

- **WHEN** the user changes the Monaco model
- **THEN** the plugin reports `plugin/dirty` with `true` and the shell tab shows
  the unsaved indicator

#### Scenario: Ctrl+S requests the shell save

- **WHEN** the document is dirty and the plugin can write, and the user presses
  Ctrl/Cmd+S inside Monaco
- **THEN** the plugin sends one id-less `plugin/request-save` and waits for the
  shell's `shell/request-save` before sending content

#### Scenario: Ctrl+S does not bypass state

- **WHEN** the document is clean, read-only or the plugin lacks write capability
  and the user presses Ctrl/Cmd+S
- **THEN** the plugin sends no save request and changes no content

#### Scenario: Save round-trips exact text

- **WHEN** the shell requests a save
- **THEN** the plugin returns the exact current model text and the shell writes it
  with the version it last delivered

#### Scenario: Failed save stays dirty

- **WHEN** the shell reports a conflict, timeout or permission failure
- **THEN** the plugin keeps the edit and remains dirty instead of claiming success

#### Scenario: External change is visible

- **WHEN** the open file changes on disk
- **THEN** the plugin shows the external-change state and does not replace a dirty
  model without an explicit reload

#### Scenario: Deleted file is not recreated

- **WHEN** the open file is deleted and the shell requests a save
- **THEN** the plugin returns the buffer but the shell's write fails with
  `not-found` and no file is recreated
