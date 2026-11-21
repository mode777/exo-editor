# Spec Delta

## ADDED Requirements

### Requirement: Editor capability negotiation

Editor `shell/init` SHALL carry `capabilities.requestFiles` as the permission bit and `capabilities.filePicker` as the shell support bit. A shell that implements the picker SHALL send `filePicker: true`; an older shell omits it, and a plugin SHALL treat absence as `false` and SHALL NOT infer picker support from `requestFiles`.

#### Scenario: New shell advertises the picker

- **WHEN** an editor frame receives `shell/init` with `capabilities.filePicker: true` and `capabilities.requestFiles: true`
- **THEN** the plugin may offer the picker and may send `plugin/request-files`

#### Scenario: Older shell omits the support bit

- **WHEN** `shell/init` carries `capabilities.requestFiles: true` but no `capabilities.filePicker`
- **THEN** the plugin treats the picker as unsupported and keeps manual path entry as its fallback

#### Scenario: Support does not grant permission

- **WHEN** `shell/init` carries `capabilities.filePicker: true` but `capabilities.requestFiles: false`
- **THEN** the plugin sends no `plugin/request-files` and uses no picker action

### Requirement: File picker request

An active editor handler SHALL be able to send one correlated `plugin/request-files` carrying optional `multiple` and `directory` fields; an omitted `multiple` defaults to `false`. The shell SHALL validate the message shape, the `workspace:read` permission, the handler phase and the active-frame gate, and SHALL reply with `shell/files-selected` carrying only selected workspace paths or with `shell/error`.

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

#### Scenario: Directory hint

- **WHEN** the request carries a valid workspace path in `directory`
- **THEN** the picker starts there; a missing, reserved or invalid hint SHALL fall back to the handler's directory without an error that reveals whether the hint exists

### Requirement: File picker selection constraints

The picker SHALL return only paths the user explicitly selected, SHALL exclude `/exo.json` and every path under `/.exo/` through the plugin-scoped workspace facade, SHALL re-check the reserved set before replying, and SHALL return no content, metadata, version, `FileSystemHandle`, `File` or `Blob`.

#### Scenario: Reserved entries are hidden

- **WHEN** the picker lists the workspace root
- **THEN** `exo.json` and `.exo` are absent from the picker and cannot be selected

#### Scenario: Reserved path race

- **WHEN** a selected path resolves to a reserved path before the reply is sent
- **THEN** the shell replies `permission-denied` and returns no path

#### Scenario: Paths only

- **WHEN** the user selects files
- **THEN** the reply contains workspace paths only and no content, stat, version or handle

#### Scenario: Read rules still apply

- **WHEN** the plugin reads a selected path through `plugin/request-file`
- **THEN** the existing containment, reserved-path, permission and `maxRequestBytes` rules apply unchanged

#### Scenario: Selected path disappears

- **WHEN** a selected file is deleted before the plugin reads it
- **THEN** the read fails with `not-found` and the picker reply is not reissued

### Requirement: File picker concurrency and lifecycle

The shell SHALL allow at most one pending picker request per frame and one open picker across all frames, SHALL reply `rate-limited` to a request that arrives while a picker is open, and SHALL accept a request only from the active, visible, focused handler. The shell SHALL close the picker without a reply when that handler is disposed, its plugin is removed, its tab closes, its tab becomes inactive or the workspace switches.

#### Scenario: Inactive or hidden frame

- **WHEN** a hidden, inactive or unfocused handler sends `plugin/request-files`
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
