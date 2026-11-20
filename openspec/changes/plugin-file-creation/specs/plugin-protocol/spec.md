# Spec Delta

## MODIFIED Requirements

### Requirement: Error reporting

The shell SHALL report protocol failures as `shell/error` with a stable code from `unsupported-message`, `unsupported-version`, `protocol-violation`, `timeout`, `loading-failed`, `permission-denied`, `not-found`, `not-a-file`, `not-a-directory`, `already-exists`, `too-large`, `conflict`, `rate-limited`, `unsupported-topic` or `internal`, SHALL include a user-safe message at most, and SHALL NOT expose stack traces, provider text or paths outside the requested scope.

#### Scenario: Reserved path

- **WHEN** a handler requests `/exo.json`
- **THEN** the error code is `permission-denied` and the message contains no content or metadata from the file

#### Scenario: Internal failure

- **WHEN** the provider fails for an unexpected reason
- **THEN** the plugin receives `internal` and the provider's message stays in the shell log

#### Scenario: Unsupported local topic

- **WHEN** a handler publishes or subscribes to a malformed local topic
- **THEN** the plugin receives `unsupported-topic` with a message naming the expected `local/<name>` form

#### Scenario: Existing new-file target

- **WHEN** a create request targets an existing file
- **THEN** the plugin receives `already-exists` with a message and the existing file is unchanged

### Requirement: Limits and protocol versioning

The shell SHALL enforce a 64-request in-flight limit per frame, a 16 MiB message payload cap, a 64 KiB content-view payload cap, an 8 MiB generated new-file cap, the advertised per-file read cap, a 10-second ready timeout, a 10-second registration timeout, a 5-second save timeout, a 1-second dispose timeout, a budget of three protocol violations before teardown, a maximum of 20 concurrently open handler frames per plugin, a maximum of eight panels per plugin, a maximum of sixteen declared content views per plugin, a maximum of ten open content-view tabs per plugin, a shell-wide maximum of fifty plugin-initiated open file tabs, one pending new-file dialog per shell, and a ten-per-second new-file request budget per frame.

#### Scenario: Oversized payload

- **WHEN** a frame sends a message larger than 16 MiB
- **THEN** the shell rejects it with `too-large` and does not buffer it

#### Scenario: Oversized content-view payload

- **WHEN** `plugin/open-view` carries a payload larger than 64 KiB
- **THEN** the shell rejects it with `too-large` and a message naming the actual size and the 64 KiB limit, and opens no tab

#### Scenario: Oversized generated file

- **WHEN** `plugin/request-new-file` carries more than 8 MiB of text or bytes
- **THEN** the shell rejects it with `too-large`, names the actual size and the 8 MiB limit, and opens no dialog

#### Scenario: Oversized local event

- **WHEN** a frame publishes a local event whose payload exceeds 1 MiB
- **THEN** the shell rejects it with `too-large` even though the envelope is below the 16 MiB message cap

#### Scenario: Handler frame cap

- **WHEN** a plugin already has 20 handler frames and another matching file opens
- **THEN** the shell mounts no 21st frame and opens that document in the shell fallback renderer with a notice

#### Scenario: Content-view tab cap

- **WHEN** a plugin already has ten content-view tabs open and requests another
- **THEN** the shell replies `rate-limited` with a message and creates no tab

#### Scenario: Plugin-initiated tab cap

- **WHEN** plugin-initiated open requests would exceed fifty open file tabs in one workspace
- **THEN** the shell replies `rate-limited` with a message and opens no further tab

#### Scenario: One new-file dialog

- **WHEN** a new-file dialog is open and another frame requests one
- **THEN** the shell replies `rate-limited` and opens no second dialog

#### Scenario: New-file request rate

- **WHEN** a frame exceeds ten new-file requests in a rolling second
- **THEN** the shell replies `rate-limited` and opens no dialog for the excess

#### Scenario: Repeated violations

- **WHEN** a frame exceeds its protocol-violation budget
- **THEN** the shell reports `protocol-violation` and unloads the frame

#### Scenario: Additive fields within a major

- **WHEN** a message includes an unknown optional field within protocol major 1
- **THEN** the shell ignores the field and processes the known parts

## ADDED Requirements

### Requirement: New-file creation request

An editor or view frame with `workspace:write` SHALL send a correlated `plugin/request-new-file` carrying exactly one of `text` or `bytes`, an optional suggested name and an optional directory hint. The shell SHALL open one shell-owned Save As dialog, write the result create-only and reply `shell/new-file-result { path, version }` or `{ cancelled: true }`.

#### Scenario: Text creation

- **WHEN** a frame sends `{ text, suggestedName }`
- **THEN** the shell opens the dialog, writes the UTF-8 text to the user's chosen path and replies with the path and version

#### Scenario: Binary creation

- **WHEN** a frame sends `{ bytes }`
- **THEN** the shell writes the exact bytes and replies with the path and version

#### Scenario: Exactly one content field

- **WHEN** the request carries both `text` and `bytes`, or neither
- **THEN** the shell rejects it as a protocol violation and opens no dialog

#### Scenario: Suggested name is a hint

- **WHEN** `suggestedName` is invalid, contains a separator or is reserved
- **THEN** the shell ignores the hint, opens the dialog with an empty name and grants nothing

#### Scenario: Directory hint is a hint

- **WHEN** `directory` is missing, invalid or reserved
- **THEN** the shell falls back silently to its normal start directory

#### Scenario: Cancellation

- **WHEN** the user cancels or closes the dialog
- **THEN** the shell writes nothing and replies `{ cancelled: true }`

#### Scenario: Missing write permission

- **WHEN** the frame's plugin lacks `workspace:write` or the workspace is read-only
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Hidden or inactive frame

- **WHEN** the frame is not visible, active or focused
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Collision

- **WHEN** the chosen name already exists
- **THEN** the shell reports `already-exists` in the dialog, keeps it open and writes nothing

#### Scenario: Success result

- **WHEN** the create succeeds
- **THEN** the reply carries the workspace-absolute path and the new version and the shell does not open a tab automatically

#### Scenario: Disposal during the dialog

- **WHEN** the frame is disposed while the dialog is open
- **THEN** the dialog closes, no write occurs and the pending request settles without a late write

### Requirement: New-file capability negotiation

`shell/init` SHALL carry `capabilities.createFile` for the runtime request and registration `shell/init` SHALL carry `capabilities.newFiles` for template registration. An older shell omits them, and a plugin SHALL treat absence as `false`.

#### Scenario: New shell advertises creation

- **WHEN** an editor or view frame receives `capabilities.createFile: true`
- **THEN** the plugin may offer its create action

#### Scenario: New shell advertises templates

- **WHEN** a registration frame receives `capabilities.newFiles: true`
- **THEN** the controller may register a declared template

#### Scenario: Older shell omits support

- **WHEN** a support bit is absent
- **THEN** the plugin does not offer the corresponding action and registers no template

#### Scenario: Support is not permission

- **WHEN** `capabilities.createFile` is true but the manifest lacks `workspace:write`
- **THEN** the shell replies `permission-denied` and opens no dialog
