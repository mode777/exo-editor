# plugin-commands Specification

## Purpose
Lets a plugin expose user-invoked actions that run in its own sandboxed frame, with explicit targets, attribution and a bounded invocation lifecycle.

## Requirements

### Requirement: Command contribution semantics

A plugin command SHALL be user-invoked and SHALL run only inside a live frame that belongs to the same plugin identity. A command SHALL declare an `id`, a `title`, an optional `category`, a `target` and optional `menus`. A target SHALL be `activeEditor`, a panel id or a content-view id declared in the same manifest. A command SHALL NOT create a new frame mode, run in the registration frame or run without a user action.

#### Scenario: Editor command

- **WHEN** a manifest declares a command with `target: "activeEditor"`
- **THEN** the command is available only while the active document is handled by that plugin

#### Scenario: Panel command

- **WHEN** a manifest declares a command whose target is one of its declared panels
- **THEN** invoking the command reveals that panel before delivery

#### Scenario: Content-view command

- **WHEN** a manifest declares a command whose target is one of its declared content views
- **THEN** invoking the command opens or focuses that content-view tab before delivery

#### Scenario: Undeclared target

- **WHEN** a command targets a panel or content view that the manifest does not declare
- **THEN** validation rejects the manifest and names the command and target field

#### Scenario: No autonomous execution

- **WHEN** a command is declared but the user has not invoked it
- **THEN** the shell sends no command message to any frame

### Requirement: Command menu placement

A command SHALL appear in the command palette unless its declaration restricts placement. `editor/title` SHALL be valid only with an `activeEditor` target, and `explorer/context` SHALL be valid only with a panel or content-view target. A declaration that combines an invalid target and menu SHALL be rejected at manifest validation.

#### Scenario: Palette is the default

- **WHEN** a command omits `menus`
- **THEN** it appears in the command palette only

#### Scenario: Editor title action

- **WHEN** a command declares `menus: ["commandPalette", "editor/title"]` with an `activeEditor` target
- **THEN** it is listed in the palette and as a shell-owned action above the matching editor

#### Scenario: Explorer context action

- **WHEN** a command declares `menus: ["commandPalette", "explorer/context"]` with a panel target
- **THEN** it is listed in the palette and in the explorer context menu for the selected entry

#### Scenario: Invalid editor-title declaration

- **WHEN** a command declares `editor/title` with a panel target
- **THEN** validation rejects the manifest

#### Scenario: Invalid explorer declaration

- **WHEN** a command declares `explorer/context` with an `activeEditor` target
- **THEN** validation rejects the manifest

### Requirement: Command registration activation

The shell SHALL activate a command only after the plugin completes registration, SHALL accept only command ids the manifest declares, and SHALL require every panel or content-view target of a registered command to be registered in the same session. A command whose target is not registered SHALL be rejected with `target-not-registered` and SHALL appear in no surface.

#### Scenario: Registered command becomes active

- **WHEN** a controller registers a declared command and completes registration
- **THEN** the command appears in its declared surfaces

#### Scenario: Unregistered command stays hidden

- **WHEN** a manifest declares three commands and the controller registers one
- **THEN** only that command appears; the other two remain available but inactive

#### Scenario: Missing target

- **WHEN** a controller registers a panel-target command without registering its panel
- **THEN** the command is rejected with `target-not-registered` and no surface lists it

#### Scenario: Duplicate registration

- **WHEN** a controller registers the same command id twice before completing
- **THEN** exactly one active command is created

#### Scenario: Command cap

- **WHEN** a manifest declares more than 32 commands
- **THEN** validation rejects the manifest

### Requirement: Command invocation

The shell SHALL resolve one live target frame for an invocation, SHALL ensure that frame is active before sending `shell/command`, and SHALL send at most one in-flight invocation per command. An explorer invocation SHALL carry `{ path, kind }` for the selected entry. A palette or editor-title invocation SHALL carry no arguments. The shell SHALL NOT forward file content, a handle, a `File` or a `Blob` with an invocation.

#### Scenario: Active editor target

- **WHEN** the user invokes an `activeEditor` command while a document handled by the same plugin is active
- **THEN** the shell sends one `shell/command` to that document's handler frame

#### Scenario: Inactive editor target

- **WHEN** the active document is handled by another plugin or by the shell text surface
- **THEN** the `activeEditor` command is not listed and a stale invocation performs no message delivery

#### Scenario: Panel is mounted on demand

- **WHEN** the user invokes a command whose panel has never been revealed
- **THEN** the shell reveals and mounts the panel, waits for it to become active and then sends the command

#### Scenario: Content view is reused

- **WHEN** the user invokes a content-view command twice
- **THEN** the shell focuses the existing tab and sends a second command rather than creating a second tab

#### Scenario: Explorer arguments

- **WHEN** the user invokes an explorer context command on `/notes.txt`
- **THEN** the command payload carries `{ path: "/notes.txt", kind: "file" }` and no file content

#### Scenario: Palette arguments

- **WHEN** the user invokes a palette command while a document is open
- **THEN** the invocation carries no path or file content

#### Scenario: Concurrent invocation

- **WHEN** a command is already in flight and the user invokes it again
- **THEN** the second invocation is rejected with `rate-limited` and no second message is sent

### Requirement: Command results and failures

The target frame SHALL answer an invocation with `plugin/command-result` within 10 seconds. The shell SHALL show a bounded plain-text notice naming the plugin when a command reports failure or times out, SHALL record the invocation and result in the plugin log, and SHALL NOT dispose the target frame on failure or timeout. A result that arrives after the timeout or after the frame is disposed SHALL be ignored and logged.

#### Scenario: Successful command

- **WHEN** the target reports `{ ok: true }`
- **THEN** the pending invocation clears and no error notice appears

#### Scenario: Failed command

- **WHEN** the target reports `{ ok: false, message: "No selection" }`
- **THEN** the shell shows `No selection` as plain text attributed to the plugin and logs the failure

#### Scenario: Timeout

- **WHEN** the target sends no result within 10 seconds
- **THEN** the shell logs `timeout`, shows a non-blocking notice and keeps the frame mounted

#### Scenario: Late result

- **WHEN** a result arrives after the timeout
- **THEN** the shell ignores it, changes no pending state and logs the late arrival

#### Scenario: Frame disposed mid-command

- **WHEN** the target frame is disposed before its result arrives
- **THEN** the shell cancels the pending invocation and logs the disposal reason

### Requirement: Command runtime limits

The shell SHALL allow at most five concurrent invocations per plugin, SHALL enforce a five-second cooldown per command with `rate-limited`, SHALL cap a command's result message at 200 characters, and SHALL treat an invocation over the limit as a logged no-op without delivering a message.

#### Scenario: Concurrent plugin limit

- **WHEN** five commands from one plugin are in flight and a sixth is invoked
- **THEN** the sixth is rejected with `rate-limited` and no message is delivered

#### Scenario: Cooldown

- **WHEN** the same command is invoked twice within five seconds
- **THEN** the second is rejected with `rate-limited`

#### Scenario: Oversized result message

- **WHEN** a result message exceeds 200 characters
- **THEN** the shell truncates it for display and stores only the bounded text in the log

### Requirement: Command attribution and isolation

Every palette entry, explorer context entry and editor-title action SHALL identify the contributing plugin by name. A plugin command SHALL NOT use a shell command id, replace or hide a shell command, or appear under the shell's own name. The shell SHALL NOT expose an API for one plugin to invoke another plugin's command, and a command result SHALL be delivered only to the invoking shell surface.

#### Scenario: Shell command is not shadowed

- **WHEN** a plugin declares a command titled `Open Settings`
- **THEN** both the shell entry and the plugin entry are listed, and the plugin entry names the plugin

#### Scenario: No cross-plugin invocation

- **WHEN** a plugin frame tries to name another plugin's command in any message
- **THEN** the shell rejects it and delivers nothing to the other plugin

#### Scenario: Result isolation

- **WHEN** a command completes
- **THEN** its result reaches the shell and is not broadcast to other frames or plugins

### Requirement: Command teardown

Disabling, removing or revoking a plugin, and switching workspaces, SHALL remove every command from every surface, cancel its pending invocations, close a content-view tab opened solely for a command through the normal content-view teardown, and ignore late results or callbacks.

#### Scenario: Plugin is disabled

- **WHEN** the user disables a plugin with registered commands
- **THEN** its palette, explorer and editor-title entries disappear and no command is delivered to its frames

#### Scenario: Workspace switch

- **WHEN** the workspace changes
- **THEN** no command, cooldown, pending invocation or notice from the previous workspace remains

#### Scenario: Stale palette entry

- **WHEN** a palette entry from a removed plugin is invoked
- **THEN** the shell performs no delivery and records the stale invocation in the log

#### Scenario: Content-view command target closes

- **WHEN** a content-view tab opened by a command is closed
- **THEN** a later invocation opens a new tab and delivers the command after the frame is active
