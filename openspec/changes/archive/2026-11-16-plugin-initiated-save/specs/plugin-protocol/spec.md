# Spec Delta

## MODIFIED Requirements

### Requirement: Dirty state and save flow

The shell SHALL track dirty state only from `plugin/dirty`, SHALL allow at most
one in-flight save request plus one queued request, SHALL accept
`plugin/save-content` only when it answers the live `shell/request-save`, SHALL
treat the content as opaque text or bytes without parsing it, SHALL echo the
request id in `shell/save-result`, SHALL write with the version it last delivered,
and SHALL leave the document dirty when the write conflicts or times out. The
shell SHALL also accept an id-less `plugin/request-save` notification as a request
to run that same save flow for the handler's document, without accepting content
from the notification, and SHALL reject a `plugin/request-save` that carries an
`id` as a protocol violation.

#### Scenario: Dirty drives the tab

- **WHEN** a handler reports `plugin/dirty` with `true`
- **THEN** the tab shows an unsaved indicator and closing it prompts for confirmation

#### Scenario: Save round trip

- **WHEN** the shell sends `shell/request-save` and the plugin answers with content within 5 seconds
- **THEN** the shell writes with `ifVersion`, returns `shell/save-result` with the new version, and clears dirty only if the plugin has not reported dirty again

#### Scenario: Plugin requests a save

- **WHEN** an active handler sends an id-less `plugin/request-save`
- **THEN** the shell starts the same save as the Save action, sends `shell/request-save`, and accepts content only in reply to that request

#### Scenario: Save intent carries no content

- **WHEN** a `plugin/request-save` message carries an `id` or a non-empty payload
- **THEN** the shell rejects it as a protocol violation, performs no write and sends no content request

#### Scenario: Save intent coalesces

- **WHEN** a handler sends `plugin/request-save` while a save is already in flight
- **THEN** the shell creates no second write and the plugin receives the result of the existing save

#### Scenario: Save intent on a clean or read-only document

- **WHEN** a handler requests a save for a document that is clean, read-only or no longer active
- **THEN** the shell performs no write and returns no new save result

#### Scenario: Conflict

- **WHEN** the file changed on disk since the handler last read it
- **THEN** the write fails with `conflict`, the on-disk content is preserved, and the tab remains dirty

#### Scenario: Save timeout

- **WHEN** the plugin does not answer `shell/request-save` within 5 seconds
- **THEN** the save fails with `timeout`, no write occurs, and the tab remains dirty

#### Scenario: Unsolicited save content

- **WHEN** a handler sends `plugin/save-content` without a live `shell/request-save`
- **THEN** the shell performs no write, ignores the content, and counts a protocol violation

#### Scenario: Save result correlation

- **WHEN** the shell accepts save content
- **THEN** `shell/save-result` carries a `replyTo` equal to the request's `id`

#### Scenario: Content is opaque

- **WHEN** `plugin/save-content` arrives
- **THEN** the shell writes the text or bytes unchanged and never parses, formats or validates the editor's syntax

#### Scenario: Own save ordering

- **WHEN** a save succeeds
- **THEN** `shell/save-result` is delivered before the corresponding `workspace/file-changed` event
