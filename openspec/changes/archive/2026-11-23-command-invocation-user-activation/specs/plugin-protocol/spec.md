# Spec Delta

## MODIFIED Requirements

### Requirement: New-file creation request

An editor or view frame with `workspace:write` SHALL send a correlated `plugin/request-new-file` carrying exactly one of `text` or `bytes`, an optional suggested name and an optional directory hint. The shell SHALL open one shell-owned Save As dialog, write the result create-only and reply `shell/new-file-result { path, version }` or `{ cancelled: true }`. A frame that is the target of a live command invocation SHALL be treated as user-activated for this request even without DOM focus, until the invocation settles, times out or the frame is disposed.

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

- **WHEN** the frame is not visible or active, or is not focused and has no live command invocation
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Live command target without focus

- **WHEN** the target frame of a live command invocation sends `plugin/request-new-file` without owning DOM focus
- **THEN** the shell opens the Save As dialog, applies every existing permission, capability, size, rate and dialog rule and does not move focus

#### Scenario: Request after the invocation settles

- **WHEN** the same frame sends `plugin/request-new-file` after its command result, timeout or disposal
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

### Requirement: File picker request

An active editor handler or view frame SHALL be able to send one correlated `plugin/request-files` carrying optional `multiple` and `directory` fields; an omitted `multiple` defaults to `false`. The shell SHALL validate the message shape, the `workspace:read` permission, the frame phase and the active-frame gate, and SHALL reply with `shell/files-selected` carrying only selected workspace paths or with `shell/error`. A frame that is the target of a live command invocation SHALL be treated as user-activated for this request even without DOM focus, until the invocation settles, times out or the frame is disposed.

#### Scenario: Single selection

- **WHEN** an active handler sends `plugin/request-files` with an `id` and the user selects one file
- **THEN** the shell replies `shell/files-selected` with `replyTo` equal to that id and exactly one `/`-rooted workspace path

#### Scenario: Multiple selection

- **WHEN** an active handler sends `multiple: true` and the user selects several files
- **THEN** the reply carries at most 32 paths in selection order

#### Scenario: User cancels

- **WHEN** the user cancels or closes the picker
- **THEN** the shell replies `shell/files-selected` with an empty `paths` array and makes no other change

#### Scenario: Missing permission

- **WHEN** a handler whose plugin lacks `requestFiles` sends `plugin/request-files`
- **THEN** the shell replies `permission-denied`, opens no picker and reads nothing

#### Scenario: Malformed request

- **WHEN** `plugin/request-files` lacks an `id`, has a non-boolean `multiple`, or has a non-string `directory`
- **THEN** the shell rejects it as a protocol violation, opens no picker and returns no path

#### Scenario: Wrong phase

- **WHEN** a registration frame sends `plugin/request-files`
- **THEN** the shell rejects it as a protocol violation and opens no picker

#### Scenario: Live command target without focus

- **WHEN** the target frame of a live command invocation sends `plugin/request-files` without owning DOM focus
- **THEN** the shell opens the picker, applies every existing permission, rate and dialog rule and does not move focus

#### Scenario: Request after the invocation settles

- **WHEN** the same frame sends `plugin/request-files` after its command result, timeout or disposal
- **THEN** the shell replies `permission-denied` and opens no picker

#### Scenario: Directory hint

- **WHEN** the request carries a valid workspace path in `directory`
- **THEN** the picker starts there; a missing, reserved or invalid hint SHALL fall back to the handler's directory without an error that reveals whether the hint exists

### Requirement: File picker concurrency and lifecycle

The shell SHALL allow at most one pending picker request per frame and one open picker across all frames, SHALL reply `rate-limited` to a request that arrives while a picker is open, and SHALL accept a request only from an active, visible frame that is focused or the target of a live command invocation. The shell SHALL close the picker without a reply when that frame is disposed, its plugin is removed, its tab closes, its tab becomes inactive or the workspace switches.

#### Scenario: Inactive or hidden frame

- **WHEN** a hidden or inactive frame, or an unfocused frame without a live command invocation, sends `plugin/request-files`
- **THEN** the shell replies `permission-denied` and opens no picker

#### Scenario: One picker globally

- **WHEN** any frame requests a picker while another picker is open
- **THEN** the shell replies `rate-limited` and leaves the open picker unchanged

#### Scenario: Disposal closes the picker

- **WHEN** the requesting handler is disposed while its picker is open
- **THEN** the picker closes, no `shell/files-selected` is sent, and a later answer is dropped

#### Scenario: Workspace switch closes the picker

- **WHEN** the workspace switches while a picker is open
- **THEN** the picker closes before the old session is released and no path from the old workspace is sent

#### Scenario: Tab close closes the picker

- **WHEN** the requesting document's tab is closed while the picker is open
- **THEN** the picker closes and no reply is sent for the disposed handler

#### Scenario: Tab switch closes the picker

- **WHEN** another tab becomes active while the picker is open
- **THEN** the picker closes and no reply is sent for the now-inactive handler
