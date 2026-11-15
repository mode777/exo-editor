# Spec Delta

## MODIFIED Requirements

### Requirement: No file access in the registration layer

The plugin host SHALL NOT request workspace content, create a plugin-facing workspace facade or send file metadata to a registration frame, and a registration frame that sends a handler-phase message SHALL be treated as a protocol violation with no workspace read. A handler frame SHALL be the only plugin path to file metadata or content.

#### Scenario: Handler message in registration mode

- **WHEN** a registration frame sends `plugin/request-file`, `plugin/dirty`, `plugin/save-content`, `plugin/subscribe` or `plugin/unsubscribe`
- **THEN** the shell replies `protocol-violation`, reads no file and changes no registration state

#### Scenario: Init carries no content

- **WHEN** a controller frame receives `shell/init`
- **THEN** the payload contains shell, workspace, permission and theme metadata and no file path, bytes or metadata

#### Scenario: No plugin facade is built

- **WHEN** a plugin is loaded in the registration phase
- **THEN** the host never calls the session's plugin facade and no `FileSystemHandle`, `File` or `Blob` reaches the frame

#### Scenario: Handler sessions are the only content path

- **WHEN** an active plugin opens a document
- **THEN** its metadata and content reach the plugin only through that document's handler session, never through the registration frame
