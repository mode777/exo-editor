# Spec Delta

## MODIFIED Requirements

### Requirement: Editor client

The SDK SHALL expose the initialized file metadata, read files by path and
encoding with correlated replies, report dirty state, request a shell save for the
bound document, answer save requests with text or bytes, expose external-change
and disposal notifications, and reject outstanding requests when the frame is
disposed.

#### Scenario: Metadata before content

- **WHEN** an editor frame completes its handshake
- **THEN** the SDK exposes the file metadata and no file content until the plugin
  calls the read method

#### Scenario: Read round trip

- **WHEN** the plugin reads a relative or absolute path
- **THEN** the SDK sends one `plugin/request-file` and resolves that request from
  the matching `shell/file-content`

#### Scenario: Read error

- **WHEN** the shell replies with `shell/error` for a read
- **THEN** the SDK rejects that read with the stable error code and leaves other
  pending requests untouched

#### Scenario: Dirty report

- **WHEN** the plugin reports a dirty or clean state
- **THEN** the SDK sends one `plugin/dirty` with the boolean value

#### Scenario: Request a save

- **WHEN** the plugin calls `requestSave()`
- **THEN** the SDK sends one id-less `plugin/request-save` notification with no
  content and does not create a correlated pending request

#### Scenario: Save request and result

- **WHEN** the shell sends `shell/request-save`
- **THEN** the SDK invokes the plugin's save handler, answers with
  `plugin/save-content` using the request's id as `replyTo`, and resolves the
  plugin's save call from the matching `shell/save-result`

#### Scenario: No save handler

- **WHEN** the shell requests a save but the plugin registered no save handler
- **THEN** the SDK sends no content and the shell's five-second timeout leaves
  the document dirty instead of writing an empty or invented payload

#### Scenario: External change notification

- **WHEN** the shell sends `shell/file-changed`
- **THEN** the SDK delivers its path, kind and optional version to the plugin
  without changing the plugin's dirty state

#### Scenario: Disposal

- **WHEN** the shell sends `shell/dispose`
- **THEN** the SDK rejects every outstanding request, marks the client closed,
  sends `plugin/dispose-ack` once, and ignores later messages
