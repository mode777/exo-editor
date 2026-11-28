# Spec Delta

## ADDED Requirements

### Requirement: Undo and redo intents

The shell SHALL send id-less `shell/undo` and `shell/redo` notifications only to
the active, writable editor handler for the active document. The messages SHALL
carry no content, version or reply, and SHALL be sent regardless of the
document's dirty state. The shell SHALL NOT send them to registration frames,
view frames, inactive tabs, shell text documents or read-only plugin documents.

#### Scenario: Active writable handler receives the intent

- **WHEN** the active document is a writable plugin editor and the user invokes Undo or Redo
- **THEN** the shell sends exactly one `shell/undo` or `shell/redo` to that document's handler with no `id`, content or version

#### Scenario: Clean document still receives the intent

- **WHEN** the active plugin-backed document is clean and the user invokes Undo
- **THEN** the shell still sends `shell/undo` because the plugin's history may move the buffer away from the saved text

#### Scenario: Non-editor phases receive nothing

- **WHEN** the user invokes Undo while a registration frame, a view frame, an inactive tab or a shell text document is active
- **THEN** the shell sends no undo or redo notification

#### Scenario: Read-only editor receives nothing

- **WHEN** the active plugin-backed document is read-only, the plugin lacks `workspace:write`, or the workspace session is not writable
- **THEN** the shell sends no undo or redo notification and changes no content

#### Scenario: Intent carries no reply

- **WHEN** the shell sends `shell/undo` or `shell/redo`
- **THEN** the message has no `id`, the plugin sends no acknowledgement or content, and no timeout, queue or retry is created

#### Scenario: Older plugin ignores the intent

- **WHEN** a plugin does not implement `shell/undo` or `shell/redo`
- **THEN** it ignores the unknown id-less message without sending content, changing its buffer or treating it as a save or protocol error

### Requirement: Undo history stays plugin-owned

The shell SHALL NOT keep an undo stack, content snapshot or `canUndo`/`canRedo`
state for a plugin-backed document. The plugin SHALL apply each intent to its own
history and SHALL report any resulting dirty change only through `plugin/dirty`.
An intent the plugin's history cannot apply SHALL be a silent no-op.

#### Scenario: Undo changes the reported state

- **WHEN** the plugin applies `shell/undo` and the buffer differs from the saved text
- **THEN** it reports `plugin/dirty` with `true` and the shell updates the tab from that report

#### Scenario: Undo returns to the saved text

- **WHEN** the plugin applies `shell/undo` and the buffer equals the saved text
- **THEN** it reports `plugin/dirty` with `false` and the tab indicator clears without a write

#### Scenario: Empty history is a no-op

- **WHEN** the plugin receives `shell/undo` with no history entry, or `shell/redo` with no redo entry
- **THEN** its buffer and dirty state are unchanged and it sends no error or content

#### Scenario: The shell never restores history

- **WHEN** a plugin frame is disposed and the document is reopened or remounted
- **THEN** the shell starts with no history and does not replay or restore previous undo entries

#### Scenario: Undo during a save does not create a second write

- **WHEN** `shell/undo` arrives while a save is in flight
- **THEN** the save still uses the content the handler returns for the live request, and the intent starts no additional write or save request
