# Spec Delta

## Purpose

Defines the per-document handler lifecycle and its mediated file access. This
delta adds the opaque editor instance id used by editor-bound panels; it adds no
file access and changes no save behavior.

## MODIFIED Requirements

### Requirement: Handler initialization carries metadata only

A handler frame SHALL complete the protocol handshake and receive `shell/init`
with the document's path, name, directory, size, mtime, version, optional
language hint, an `editor` block with an opaque shell-assigned `instanceId` for
this handler frame, plugin capabilities, limits, theme, locale and workspace
name, and SHALL receive no file text, bytes, blob or handle until it sends
`plugin/request-file` with a live request id.

#### Scenario: Init has no content

- **WHEN** a handler frame receives `shell/init`
- **THEN** the payload contains metadata and no file content

#### Scenario: Instance id is per frame

- **WHEN** a handler frame completes its handshake
- **THEN** `editor.instanceId` is present, stable while that frame lives and different when the document is reopened, retried or moved to another matching editor

#### Scenario: Instance id is the local-event source

- **WHEN** the handler publishes a `local/*` event
- **THEN** the shell sets `from` to the same value as `editor.instanceId`

#### Scenario: Content requires a request

- **WHEN** a handler has received its initialization and sent no file request
- **THEN** the shell has transferred no content for that document

#### Scenario: Unready handler falls back

- **WHEN** a handler frame does not send `plugin/ready` within the protocol's ready timeout
- **THEN** the shell removes the frame, logs the timeout and opens the document in the text surface with a notice

#### Scenario: Reopening mounts a new frame

- **WHEN** the user closes and reopens a document handled by a plugin
- **THEN** a new handler frame is mounted and the previous frame is not reused
