# Spec Delta

## MODIFIED Requirements

### Requirement: Runtime new-file request

An active visible editor or view frame with `workspace:write` SHALL send a correlated `plugin/request-new-file` carrying `text` or `bytes`, an optional suggested name and an optional directory hint. The shell SHALL open one Save As dialog, SHALL write create-only after confirmation, and SHALL reply `shell/new-file-result { path, version }` or `{ cancelled: true }`. A frame that is focused or the target of a live command invocation SHALL satisfy the activation gate; the shell SHALL not move focus to create it.

#### Scenario: Text request

- **WHEN** a frame sends `{ text: "# Report\\n...", suggestedName: "report.md" }`
- **THEN** the shell opens the Save As dialog and writes the UTF-8 text to the chosen path

#### Scenario: Bytes request

- **WHEN** a frame sends `{ bytes: ArrayBuffer, suggestedName: "image.png" }`
- **THEN** the shell writes the exact bytes without decoding them

#### Scenario: Cancel

- **WHEN** the user cancels or closes the Save As dialog
- **THEN** the shell writes nothing and replies `{ cancelled: true }`

#### Scenario: Directory hint

- **WHEN** the request carries a directory that is missing, reserved or invalid
- **THEN** the shell silently starts at its fallback directory and the hint grants nothing

#### Scenario: Missing write permission

- **WHEN** the frame's plugin lacks `workspace:write` or the session is read-only
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Hidden or inactive frame

- **WHEN** a frame that is not visible or active, or is not focused and has no live command invocation, sends the request
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Live command target without focus

- **WHEN** a command target frame without DOM focus sends the request during its live invocation
- **THEN** the shell opens the Save As dialog, applies every existing permission, size, rate and dialog rule and does not move focus

#### Scenario: Request after the command settles

- **WHEN** the target frame sends the request after the command result, timeout or disposal
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Disposal revokes the grant

- **WHEN** the target frame or its plugin is disposed while a command-granted Save As dialog is open
- **THEN** the dialog closes without a late write or reply and the grant is not inherited by another frame

#### Scenario: One dialog at a time

- **WHEN** a Save As dialog is already open or the frame already has one pending
- **THEN** the shell replies `rate-limited` and opens no second dialog

#### Scenario: Size limit

- **WHEN** the text or bytes exceed 8 MiB
- **THEN** the shell replies `too-large` with a message naming the actual size and the limit, and opens no dialog

#### Scenario: Result carries the path

- **WHEN** the write succeeds
- **THEN** `shell/new-file-result` carries the workspace-absolute path and the new version

#### Scenario: No automatic open

- **WHEN** a runtime-generated file is written
- **THEN** the shell does not create a tab for it unless the frame asks to open it
