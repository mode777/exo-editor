# Spec Delta

## MODIFIED Requirements

### Requirement: External change notification

The shell SHALL notify a handler when it observes a change to that handler's
document, SHALL identify the kind (`changed`, `deleted` or `renamed`) and the new
version when one exists, and SHALL NOT auto-reload a dirty buffer. This
`shell/file-changed` message SHALL be the immediate, targeted notification for
the bound document and SHALL NOT be a topic subscription event; the same
observation also feeds the coalesced `workspace/file-changed` topic for
subscribers.

#### Scenario: External write

- **WHEN** the open file changes outside the handler
- **THEN** the handler receives the new path and version and decides whether to
  reload, keep its buffer or ask the user

#### Scenario: Dirty buffer is not replaced

- **WHEN** a dirty handler receives an external-change notification
- **THEN** the shell leaves the buffer and the dirty state untouched

#### Scenario: Deleted file

- **WHEN** the open file is deleted
- **THEN** the handler is notified with `deleted` and a later save fails with
  `not-found` instead of recreating the file silently

#### Scenario: Notification does not require a subscription

- **WHEN** a handler for the open document has not subscribed to `workspace/file-changed`
- **THEN** it still receives the targeted notification for that document

#### Scenario: Subscription is separate from the targeted notification

- **WHEN** a handler subscribes to `workspace/file-changed`
- **THEN** it receives topic events for every changed path, including its own,
  in addition to the targeted notifications for its document
