# Spec Delta

## MODIFIED Requirements

### Requirement: Save round trip is opaque and conflict-safe

The shell SHALL save a plugin-backed document by sending at most one live
`shell/request-save` plus one queued request, SHALL write exactly the returned
text or bytes with the version it last delivered as `ifVersion` and no
transformation, SHALL answer within the protocol's save timeout with
`shell/save-result`, and SHALL leave the document dirty when the write conflicts,
times out or is denied. The shell SHALL also let an active handler trigger the
same save through an id-less `plugin/request-save`, SHALL coalesce the trigger
with a pending save, and SHALL NOT let the trigger supply content or a version.

#### Scenario: Save writes exact bytes

- **WHEN** a handler answers `shell/request-save` with bytes
- **THEN** the provider receives those bytes unchanged and the result carries the new version

#### Scenario: Plugin-initiated save writes the same way

- **WHEN** an active writable handler sends `plugin/request-save`
- **THEN** the shell sends `shell/request-save`, writes the returned content with
  the last delivered version and returns the same `shell/save-result`

#### Scenario: Plugin-initiated save coalesces

- **WHEN** the handler requests a save while one is already pending
- **THEN** the shell performs one write and the handler receives one result

#### Scenario: Plugin-initiated save respects state

- **WHEN** a clean, read-only or inactive document receives a save trigger
- **THEN** the shell writes nothing and offers no bypass around the Save action's
  permission and dirty checks

#### Scenario: Conflict preserves disk content

- **WHEN** the file changed after the handler's last read or notification
- **THEN** the write fails with `conflict`, the on-disk content remains, and the tab stays dirty

#### Scenario: Timeout keeps the tab dirty

- **WHEN** the handler does not answer within 5 seconds
- **THEN** the save fails with `timeout`, no write occurs, and the tab remains dirty

#### Scenario: Read-only plugin editor has no save

- **WHEN** the plugin lacks `workspace:write` or the session is not writable
- **THEN** no Save action is offered and a save attempt returns `permission-denied` without writing

#### Scenario: Save ordering

- **WHEN** a save succeeds
- **THEN** `shell/save-result` is delivered before any change notification for that save

#### Scenario: Late save content is ignored

- **WHEN** content arrives for a request that already timed out or was cancelled
- **THEN** the shell ignores it, writes nothing and counts a protocol violation
