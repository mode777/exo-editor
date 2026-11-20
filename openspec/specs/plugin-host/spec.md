# plugin-host Specification

## Purpose
Defines the workspace-scoped plugin host: how validated declarations become
consented registration frames, how their editor contributions become a
deterministic registry, and what status and log the shell exposes while doing it.

## Requirements

### Requirement: Workspace-scoped host lifecycle

The plugin host SHALL attach after the workspace becomes ready, SHALL initialize
only enabled entries from a valid declaration, SHALL NOT fetch a manifest for a
disabled entry or for an invalid or absent declaration, SHALL reconcile live add,
remove and enabled changes, and SHALL detach before the workspace session is
released.

#### Scenario: Enabled entries load

- **WHEN** a valid declaration contains three enabled entries and the workspace becomes ready
- **THEN** the host starts manifest loading for all three and none is skipped

#### Scenario: Disabled entry is never fetched

- **WHEN** a declaration entry has `enabled: false`
- **THEN** no manifest request is made for it and its host status is `disabled`

#### Scenario: Invalid declaration loads nothing

- **WHEN** the declaration is invalid or absent
- **THEN** the host has no plugin records, makes no manifest request and keeps the workspace usable

#### Scenario: Live add

- **WHEN** an enabled entry is added to a valid declaration while the workspace is ready
- **THEN** the host fetches it, requests consent if needed and registers it without a reload

#### Scenario: Live remove or disable

- **WHEN** an entry is removed from the declaration or changed to `enabled: false`
- **THEN** the host closes any frame for that identity and removes its registrations immediately

#### Scenario: Workspace switch

- **WHEN** the user switches workspaces
- **THEN** the host detaches, closes every frame and clears records, registrations and log before the old session is released

### Requirement: Deterministic initialization and plugin identity

The host SHALL use the enabled entry order in `exo.json` as the initialization
order and the tie-break sequence for editor selection, independent of fetch or
registration completion order. Plugin identity SHALL be the manifest origin plus
the plugin id; when two entries resolve to the same identity, the earlier
declaration SHALL load and the later SHALL be reported as `duplicate-identity`
and not mounted.

#### Scenario: Declaration order wins

- **WHEN** two entries register equal-priority editors and the later entry completes first
- **THEN** the earlier declaration remains the selected editor and the order does not depend on timing

#### Scenario: Duplicate identity

- **WHEN** two enabled manifests on one origin declare the same plugin id
- **THEN** the entry declared first loads and the later entry is reported with `duplicate-identity`, creates no frame and adds no registration

#### Scenario: Same id on different origins

- **WHEN** two manifests on different origins declare the same plugin id
- **THEN** they are distinct plugins with distinct consent records and both may load

#### Scenario: Failed fetch does not reorder the rest

- **WHEN** an early entry times out while a later entry has already validated
- **THEN** the later entry keeps its declaration-order sequence and is not promoted

### Requirement: Consent queue

The host SHALL finish manifest validation for the enabled entries before it
starts the consent queue, SHALL present one consent request at a time in
declaration order, and SHALL mount a registration frame only after a valid
manifest, a matching persisted fingerprint or an in-session approval, and the
plugin's own consent decision.

#### Scenario: Persisted consent skips the prompt

- **WHEN** a valid manifest's fingerprint matches the stored consent for its identity
- **THEN** the host starts registration without showing the consent dialog

#### Scenario: Approval starts registration

- **WHEN** the user approves the pending consent request
- **THEN** the host records consent and mounts the controller frame for that identity

#### Scenario: Denial mounts nothing

- **WHEN** the user denies the pending consent request
- **THEN** no controller frame is mounted, the status is `denied` and the denial is remembered for the page session

#### Scenario: Widened fingerprint re-prompts

- **WHEN** a manifest changes a permission, glob, priority, origin or plugin root and the stored fingerprint no longer matches
- **THEN** the previous record is treated as absent and the plugin waits for a new decision

#### Scenario: Consent queue continues

- **WHEN** the current request is approved, denied or revoked
- **THEN** the next waiting entry is presented without reloading the workspace

#### Scenario: Revocation stops the plugin

- **WHEN** the user revokes a stored consent
- **THEN** the host closes the plugin's frames, removes its registrations and shows it as awaiting consent without opening the dialog automatically

### Requirement: Registration registry and editor selection

The host SHALL add a contribution to the registry only after
`plugin/register-complete`, SHALL key registered editors by plugin identity and
declaration order, SHALL match workspace paths against registered globs with
priority descending and then declaration order ascending, and SHALL expose every
matching contribution as an ordered candidate so the shell can offer the others
through "Open with...".

#### Scenario: Registrations activate on completion

- **WHEN** a plugin sends a registration and has not sent `plugin/register-complete`
- **THEN** no registry entry is active for it

#### Scenario: Highest priority wins

- **WHEN** two plugins register matching globs with priorities `10` and `0`
- **THEN** the `10` contribution is the first candidate and the other remains in the candidate list

#### Scenario: Declaration order breaks a tie

- **WHEN** two matching registrations share a priority
- **THEN** the contribution from the earlier declaration is first, deterministically

#### Scenario: No matching editor

- **WHEN** no registered glob matches a path
- **THEN** the candidate list is empty and the shell keeps its fallback renderer

#### Scenario: Stopped plugin leaves no registration

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** none of its contributions appear in a later match

### Requirement: Host status and plugin log

The host SHALL expose a status for every declared entry using `disabled`,
`loading`, `awaiting-consent`, `denied`, `registering`, `active` or `failed`,
SHALL attach a stable error code and the failing phase to every failure, and
SHALL keep a workspace-scoped log capped at 200 entries containing plugin id,
origin, phase, code, timestamp and a bounded message but never file content or a
manifest response body.

#### Scenario: Status follows the lifecycle

- **WHEN** an entry is valid, approved and acknowledged
- **THEN** its status moves from `loading` to `awaiting-consent` or `registering` and then `active`

#### Scenario: Failure names its phase

- **WHEN** a manifest fetch times out or a plugin never sends `plugin/ready`
- **THEN** the status is `failed` with code `timeout` and the phase that timed out

#### Scenario: Duplicate identity is reported

- **WHEN** two entries resolve to the same identity
- **THEN** the later entry's status is `failed` with code `duplicate-identity`

#### Scenario: Log is capped

- **WHEN** more than 200 host events occur in one workspace
- **THEN** only the most recent 200 are retained

#### Scenario: Log is workspace scoped

- **WHEN** the user switches workspaces
- **THEN** the log contains no entry from the previous workspace

#### Scenario: Log has no content

- **WHEN** a host event is recorded
- **THEN** it contains ids, origin, phase, code and a bounded message, and no file text, file bytes or manifest body

### Requirement: Teardown and late events

The host SHALL abort in-flight manifest requests, close every frame, discard
pending registrations and ignore late fetch, timer or message callbacks when a
plugin stops or the workspace switches, so no callback from a released plugin or
workspace can mutate current state.

#### Scenario: Late fetch after detach

- **WHEN** a manifest response from the previous workspace resolves after the new workspace is ready
- **THEN** the host ignores it, creates no frame and leaves the new records unchanged

#### Scenario: Late message after stop

- **WHEN** a closed plugin frame sends a message
- **THEN** the host drops it and does not recreate a record or registration

#### Scenario: Timers are cleared

- **WHEN** a plugin is stopped before its ready or registration timeout fires
- **THEN** the timeout performs no state change

#### Scenario: Teardown order

- **WHEN** a workspace switch or removal tears a plugin down
- **THEN** its frames are closed before the registry entry and host record are dropped

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

### Requirement: Command registry and teardown

The host SHALL add command contributions to a workspace-scoped registry only after `plugin/register-complete`, SHALL key them by plugin identity, registration order and command id, SHALL expose active commands and their target in the host snapshot, SHALL remove them when the plugin stops or the workspace switches, and SHALL drop late invocations or results from a released plugin.

#### Scenario: Commands activate on completion

- **WHEN** a controller registers a command and has not sent `plugin/register-complete`
- **THEN** no command is active and no surface lists it

#### Scenario: Snapshot exposes commands

- **WHEN** a plugin completes registration with two commands
- **THEN** the host snapshot lists both with their plugin identity, title, target and menu placements

#### Scenario: Declaration order is stable

- **WHEN** two plugins register commands
- **THEN** palette and menu ordering follows `exo.json` declaration order and then registration order, independent of acknowledgement timing

#### Scenario: Stopped plugin leaves no command

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** its commands disappear from the snapshot and a later invocation delivers nothing

#### Scenario: Workspace switch resets commands

- **WHEN** the user switches workspaces
- **THEN** no command, cooldown, pending invocation or log entry from the previous workspace remains

#### Scenario: Late result after teardown

- **WHEN** a command result arrives after the plugin or workspace was released
- **THEN** the host ignores it and changes no current record

#### Scenario: Command log has no content

- **WHEN** an invocation, result or timeout is logged
- **THEN** the entry contains the command id, plugin identity, phase, outcome and a bounded message, and no file text or bytes
