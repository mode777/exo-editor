# Spec Delta

## ADDED Requirements

### Requirement: Command invocation user activation

While a command invocation is live for its exact target frame, the shell SHALL treat that frame as user-activated for `plugin/request-new-file` and `plugin/request-files` even when the frame does not own DOM focus. The grant SHALL begin before `shell/command` delivery, SHALL end when the matching result is handled, the invocation times out, the frame is disposed, the plugin stops or the workspace switches, and SHALL NOT move focus or authorize another frame.

#### Scenario: Unfocused panel creates a file

- **WHEN** a palette command targets a panel whose frame does not own DOM focus and that frame sends `plugin/request-new-file` during the invocation
- **THEN** the shell opens the Save As dialog, applies the existing write and dialog rules and the command can report `{ ok: true }`

#### Scenario: Unfocused content view uses the picker

- **WHEN** a command targets a content-view frame without DOM focus and that frame sends `plugin/request-files` during the invocation
- **THEN** the shell opens the picker under the existing read, rate and dialog rules

#### Scenario: Result ends the grant

- **WHEN** the target frame sends `plugin/command-result` and then sends `plugin/request-new-file` or `plugin/request-files`
- **THEN** the later request is denied with `permission-denied`

#### Scenario: Timeout ends the grant

- **WHEN** the invocation times out and the target frame later sends a focus-gated file request
- **THEN** the request is denied with `permission-denied`

#### Scenario: Another frame is not authorized

- **WHEN** a different panel or content-view frame of the same plugin sends a focus-gated file request during another frame's live invocation
- **THEN** the request is denied with `permission-denied`

#### Scenario: Permissions remain in force

- **WHEN** the live command target lacks `workspace:write`, the workspace is read-only, or the frame is hidden
- **THEN** the file request is denied even though the command invocation is live

#### Scenario: Disposal revokes the grant

- **WHEN** the target frame is disposed, or its plugin stops, while a focus-gated dialog is pending
- **THEN** the grant is revoked, the dialog closes without a reply or late write and no other frame inherits the grant

#### Scenario: Focus is unchanged

- **WHEN** the shell grants activation to a command target
- **THEN** it does not focus the frame or change the shell's active element
