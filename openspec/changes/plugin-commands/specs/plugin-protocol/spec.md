# Spec Delta

## MODIFIED Requirements

### Requirement: Registration phase

The shell SHALL accept zero or more additive `plugin/register` messages followed
by exactly one `plugin/register-complete`, SHALL accept only contributions the
manifest declares and pages inside the approved plugin root, SHALL send
`shell/register-ack` with accepted and rejected entries, and SHALL unload the
registration frame after acknowledging.

#### Scenario: Registrations activate only on completion

- **WHEN** a plugin registers contributions but never sends `plugin/register-complete`
- **THEN** no registration becomes active and the frame is removed at the registration timeout

#### Scenario: Undeclared capability

- **WHEN** a plugin registers a file editor although its manifest declares no `fileEditors` contribution
- **THEN** the entry is rejected with `not-declared` and listed in the acknowledgement

#### Scenario: Declared editor is activated

- **WHEN** a plugin registers a declared glob with an entry inside the plugin root
- **THEN** the pair is accepted and becomes active after `plugin/register-complete`

#### Scenario: Declared command is activated

- **WHEN** a plugin registers a declared command id and completes registration
- **THEN** the command is accepted and becomes active after `plugin/register-complete`

#### Scenario: Registration cannot add globs

- **WHEN** a plugin registers a glob the manifest did not declare
- **THEN** that entry is rejected with `not-declared` and the manifest's approved glob set is unchanged

#### Scenario: Registration cannot add commands

- **WHEN** a plugin registers a command id the manifest did not declare
- **THEN** that entry is rejected with `not-declared` and no command becomes active

#### Scenario: Registration cannot escape the root

- **WHEN** a plugin registers an entry outside the plugin root
- **THEN** that entry is rejected with `permission-denied` before any URL reaches the browser

#### Scenario: Registration may narrow the manifest

- **WHEN** a manifest declares three editors and the plugin registers one of them
- **THEN** only that editor becomes active and the other two remain available but unregistered

#### Scenario: No contributions

- **WHEN** a plugin registers nothing and completes
- **THEN** it is recorded as a configuration-only or event-only plugin and no
  editor is created for it

#### Scenario: Invalid glob

- **WHEN** a registration contains an invalid glob
- **THEN** that entry is rejected with `invalid-glob` and the remaining valid entries still activate

#### Scenario: Frame is gone afterwards

- **WHEN** the acknowledgement is sent
- **THEN** the registration iframe is removed within 250 ms and contributes no further messages

## ADDED Requirements

### Requirement: Command registration details

`plugin/register` SHALL accept an optional `commands` array of command ids declared by the manifest. The shell SHALL preserve arrival order and SHALL deduplicate repeated ids into one registration.

#### Scenario: Command subset

- **WHEN** a manifest declares three commands and `plugin/register` carries one id
- **THEN** `acceptedCommands` contains that id and the other two are not active

#### Scenario: Duplicate command id

- **WHEN** `plugin/register` carries the same command id twice before completion
- **THEN** `acceptedCommands` contains it once

#### Scenario: Additive acknowledgement

- **WHEN** a shell receives `plugin/register` without `commands`
- **THEN** it acknowledges the editors exactly as before and omits or empties `acceptedCommands`

### Requirement: Command registration validation

The shell SHALL reject an undeclared command id with `not-declared`, SHALL reject a command whose panel or content-view target was not registered in the same session with `target-not-registered`, and SHALL return accepted ids in an additive `acceptedCommands` array with a rejected entry's kind identified when it is a command.

#### Scenario: Undeclared command

- **WHEN** `plugin/register` carries a command id the manifest did not declare
- **THEN** the entry is rejected with `not-declared` and remains absent from `acceptedCommands`

#### Scenario: Target was not registered

- **WHEN** a command targets a declared panel that the same registration did not activate
- **THEN** the command is rejected with `target-not-registered` and no surface lists it

#### Scenario: Accepted and rejected together

- **WHEN** one registration carries a valid command and an invalid command
- **THEN** `acceptedCommands` lists the valid id and `rejected` names the invalid one with its kind, index and reason

### Requirement: Command invocation message

The shell SHALL send `shell/command` with a correlated id, a registered command id and optional arguments to an editor or view frame that belongs to the same plugin identity. The arguments SHALL be `{ path, kind }` only for an explorer invocation, where `kind` is `file` or `directory`, and SHALL be absent for a palette or editor-title invocation. The message SHALL contain no file content, bytes, handle, `File` or `Blob`.

#### Scenario: Editor command delivery

- **WHEN** an `activeEditor` command is invoked for the active document
- **THEN** one `shell/command` reaches that document's handler frame with no arguments

#### Scenario: Explorer command delivery

- **WHEN** an explorer context command is invoked on a directory
- **THEN** the payload carries that path and `kind: "directory"` and no content

#### Scenario: Target is not active

- **WHEN** the resolved target frame is not active or has been disposed
- **THEN** the shell sends no command and records the invocation as unavailable

#### Scenario: Plugin sends a shell message

- **WHEN** a plugin frame sends `shell/command`
- **THEN** the shell treats it as a protocol violation, delivers nothing and counts it toward the frame's budget

#### Scenario: Unknown command at delivery

- **WHEN** a stale surface invokes a command that is no longer registered
- **THEN** the shell sends no message and records the stale invocation

### Requirement: Command result and timeout

A target frame SHALL answer `shell/command` with `plugin/command-result` carrying `ok: true` or `ok: false` and an optional message of at most 200 characters. The result SHALL echo the invocation id in `replyTo`. The shell SHALL time out an unanswered invocation after 10 seconds, SHALL ignore a second result for the same invocation, and SHALL ignore a result that arrives after the timeout or after the frame is disposed.

#### Scenario: Successful result

- **WHEN** the target replies `{ ok: true }` with the matching `replyTo`
- **THEN** the invocation completes and the shell shows no error

#### Scenario: Failed result

- **WHEN** the target replies `{ ok: false, message: "..." }`
- **THEN** the shell accepts the bounded message as plain text and logs the failure

#### Scenario: Result timeout

- **WHEN** no result arrives within 10 seconds
- **THEN** the shell records `timeout` and does not dispose the target frame

#### Scenario: Late result

- **WHEN** a result arrives after the timeout
- **THEN** the shell ignores it and changes no pending state

#### Scenario: Result in the wrong phase

- **WHEN** a registration frame sends `plugin/command-result`
- **THEN** the shell treats it as a protocol violation

### Requirement: Command capability negotiation

`shell/init` for an editor or view frame SHALL carry `capabilities.commands` as a shell support bit. The bit SHALL be absent on an older shell, and a plugin SHALL treat absence as `false`. The bit SHALL NOT grant a permission or change the target frame's existing read, write, list or event capabilities.

#### Scenario: Current shell advertises commands

- **WHEN** an editor or view frame receives `shell/init`
- **THEN** `capabilities.commands` is true and the plugin may attach a command handler

#### Scenario: Older shell omits the bit

- **WHEN** `shell/init` has no `capabilities.commands` field
- **THEN** the plugin treats command delivery as unsupported and registers no command-dependent UI

#### Scenario: Capability does not grant access

- **WHEN** a plugin without `workspace:read` receives `capabilities.commands: true`
- **THEN** its command handler still cannot read a workspace file
