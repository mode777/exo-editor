# Spec Delta

## Purpose

Defines the workspace-scoped plugin host: how validated declarations become
consented registration frames, how their editor contributions become a
deterministic registry, and what status and log the shell exposes while doing it.

## ADDED Requirements

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

The plugin host SHALL NOT request workspace content, create a plugin-facing
workspace facade or send file metadata in this layer, and a registration frame
that sends a handler-phase message SHALL be treated as a protocol violation with
no workspace read.

#### Scenario: Handler message in registration mode

- **WHEN** a registration frame sends `plugin/request-file`, `plugin/dirty`, `plugin/save-content`, `plugin/subscribe` or `plugin/unsubscribe`
- **THEN** the shell replies `protocol-violation`, reads no file and changes no registration state

#### Scenario: Init carries no content

- **WHEN** a controller frame receives `shell/init`
- **THEN** the payload contains shell, workspace, permission and theme metadata and no file path, bytes or metadata

#### Scenario: No plugin facade is built

- **WHEN** a plugin is loaded in this layer
- **THEN** the host never calls the session's plugin facade and no `FileSystemHandle`, `File` or `Blob` reaches the frame
