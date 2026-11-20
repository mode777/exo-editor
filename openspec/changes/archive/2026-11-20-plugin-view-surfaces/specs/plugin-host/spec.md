# Spec Delta

## MODIFIED Requirements

### Requirement: No file access in the registration layer

The plugin host SHALL NOT request workspace content, create a plugin-facing workspace facade or send file metadata to a registration frame, and a registration frame that sends a handler- or view-phase message SHALL be treated as a protocol violation with no workspace read. A handler or view frame SHALL be the only plugin path to file metadata or content, and every request SHALL go through the same mediated read path.

#### Scenario: Handler message in registration mode

- **WHEN** a registration frame sends `plugin/request-file`, `plugin/dirty`, `plugin/save-content`, `plugin/subscribe`, `plugin/unsubscribe`, `plugin/open-file`, `plugin/open-view` or `plugin/request-panel`
- **THEN** the shell replies `protocol-violation`, reads no file and changes no registration or layout state

#### Scenario: Init carries no content

- **WHEN** a controller frame receives `shell/init`
- **THEN** the payload contains shell, workspace, permission and theme metadata and no file path, bytes or metadata

#### Scenario: No plugin facade is built

- **WHEN** a plugin is loaded in the registration phase
- **THEN** the host never calls the session's plugin facade and no `FileSystemHandle`, `File` or `Blob` reaches the frame

#### Scenario: Handler sessions are the only content path

- **WHEN** an active plugin reads a document or requests a file from an editor or view frame
- **THEN** its metadata and content reach the plugin only through that frame's session, never through the registration frame

## ADDED Requirements

### Requirement: Panel and content-view registration

The host SHALL record registered panel and content-view ids only after `plugin/register-complete`, SHALL expose them in the workspace-scoped snapshot with their resolved entry and placement, and SHALL remove them when the plugin stops.

#### Scenario: Registration activates on completion

- **WHEN** a controller registers a panel or content view but has not sent `plugin/register-complete`
- **THEN** no view entry is active for it

#### Scenario: Subset registration

- **WHEN** a manifest declares three panels and the controller registers one
- **THEN** only that panel is active and the other two remain available but unregistered

#### Scenario: Undeclared id

- **WHEN** a controller registers a panel or content-view id the manifest did not declare
- **THEN** the entry is rejected with `not-declared`, listed in the acknowledgement and never enters the snapshot

#### Scenario: Snapshot exposes view surfaces

- **WHEN** a plugin with a primary panel and a content view is active
- **THEN** the host snapshot names the panel, its primary location and entry, and the content view, its title and entry, without page content

#### Scenario: Stop removes view surfaces

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** none of its panel or content-view entries remain in the snapshot

#### Scenario: Duplicate registration is idempotent

- **WHEN** a controller registers the same panel id twice before completing
- **THEN** exactly one active panel entry exists

#### Scenario: Registration order is stable

- **WHEN** two plugins register panels at different times
- **THEN** the snapshot and activity bar use declaration order and then registration order, independent of fetch or handshake timing

### Requirement: Host view status and log

The host SHALL expose view registrations in the plugin status and log using plugin ids, view ids, kinds and phases only, and SHALL NOT include payloads, page content or another plugin's data.

#### Scenario: Active status lists views

- **WHEN** a plugin completes registration with a panel and a content view
- **THEN** its status shows `active` and both view kinds with their ids and titles

#### Scenario: View failure names code and phase

- **WHEN** a view frame fails to load, times out or violates the protocol
- **THEN** the host records the plugin id, view id, phase and stable error code

#### Scenario: Log has no payload

- **WHEN** a navigation intent, panel request or view failure is logged
- **THEN** the entry contains no content-view payload, file content, page text or target path outside the requested scope

#### Scenario: Workspace switch resets view status

- **WHEN** the user switches workspaces
- **THEN** no view status or log entry from the previous workspace remains

### Requirement: View teardown and late events

The host SHALL close panel and content-view frames when a plugin stops, SHALL close its content-view tabs before dropping the registrations, and SHALL ignore late view messages, registrations or timer callbacks from a released plugin or workspace.

#### Scenario: Plugin stop closes views

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** its content-view tabs are closed, its view frames are disposed and its panel entries leave the snapshot

#### Scenario: Workspace switch closes views

- **WHEN** the user switches workspaces
- **THEN** every view frame of the old workspace is disposed before the old session is released

#### Scenario: Late view message

- **WHEN** a disposed view frame sends a message
- **THEN** the host drops it and does not recreate a panel, tab or registration

#### Scenario: Late registration

- **WHEN** a registration acknowledgement for a stopped plugin resolves after the stop
- **THEN** no view entry is added and no frame is created

#### Scenario: Teardown order

- **WHEN** a plugin with open content-view tabs is removed
- **THEN** its tabs and frames are closed before its host record and view entries are dropped
