# Spec Delta

## ADDED Requirements

### Requirement: Editor history intent listeners

The SDK SHALL expose additive `onUndoRequest` and `onRedoRequest` listeners on
the editor client, SHALL invoke every registered listener for the matching
intent once for each id-less `shell/undo` or `shell/redo` message, SHALL NOT
send a reply, content, save request or dirty report from the listener path, and
SHALL treat a missing listener as a no-op.

#### Scenario: Undo listener fires

- **WHEN** the shell sends one `shell/undo`
- **THEN** the SDK invokes every registered undo listener once and sends nothing back

#### Scenario: Redo listener fires

- **WHEN** the shell sends one `shell/redo`
- **THEN** the SDK invokes every registered redo listener once and sends nothing back

#### Scenario: No listener is harmless

- **WHEN** the plugin registered no undo or redo listener and the shell sends the matching intent
- **THEN** the SDK changes no state, sends no reply and does not close the connection

#### Scenario: Listener cleanup

- **WHEN** a plugin unsubscribes a history listener or the frame is disposed
- **THEN** later intents invoke no removed listener and the client stays closed after disposal

### Requirement: History listener compatibility

The history listeners SHALL be an additive SDK minor: the SDK minor advances to
`1.11.0`, the protocol major remains `1`, the manifest schema remains `1`, and an
older shell that never sends the messages leaves the listeners unused without
changing any existing client behavior.

#### Scenario: Additive compatibility

- **WHEN** the listener API ships
- **THEN** the SDK minor is `1.11.0`, the protocol major is `1`, the manifest schema is `1`, and an existing plugin that does not use the listeners continues to work

#### Scenario: Older shell

- **WHEN** a plugin using the listeners connects to a shell that never sends `shell/undo` or `shell/redo`
- **THEN** the listeners never fire, the plugin remains usable and no capability check is required
