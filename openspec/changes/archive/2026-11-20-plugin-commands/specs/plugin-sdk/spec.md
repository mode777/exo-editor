# Spec Delta

## MODIFIED Requirements

### Requirement: Registration client

The SDK SHALL let a controller register file-editor contributions and declared
command ids, signal completion exactly once, and expose the shell's accepted
globs, accepted command ids and per-contribution rejection reasons from
`shell/register-ack`.

#### Scenario: Register and complete

- **WHEN** a controller registers a declared glob with an entry inside the plugin
  root and then completes
- **THEN** the SDK sends both messages in order and resolves with the
  acknowledgement

#### Scenario: Register a command

- **WHEN** a controller registers a declared command id and completes
- **THEN** the SDK sends the id in `plugin/register` and the acknowledgement
  exposes it in `acceptedCommands`

#### Scenario: Rejection details are exposed

- **WHEN** the acknowledgement rejects a contribution
- **THEN** the SDK exposes its index, kind, reason and optional message without
  discarding the accepted globs or command ids

#### Scenario: Missing command support

- **WHEN** an older shell acknowledges a registration without `acceptedCommands`
- **THEN** the SDK reports an empty accepted-command list and does not fail the
  editor registrations

#### Scenario: Registration only in register mode

- **WHEN** an editor-mode client is asked to register an editor or a command
- **THEN** the SDK rejects the call locally and sends no registration message

## ADDED Requirements

### Requirement: Command handler client

The SDK SHALL expose `onCommand(handler)` on editor and view clients, SHALL invoke the handler with the command id and optional `{ path, kind }` arguments, and SHALL answer each invocation with `plugin/command-result` using the invocation id as `replyTo`. A resolved handler SHALL produce `{ ok: true }`; a thrown error or an explicit failure SHALL produce `{ ok: false }` with a message of at most 200 characters.

#### Scenario: Command handler

- **WHEN** the shell sends `shell/command` for a registered command
- **THEN** the SDK invokes the attached handler with the id and arguments and sends one success result

#### Scenario: Explorer arguments

- **WHEN** the invocation carries `{ path: "/notes.txt", kind: "file" }`
- **THEN** the handler receives both fields unchanged and no file content

#### Scenario: Handler failure

- **WHEN** the handler throws or returns a failure
- **THEN** the SDK sends `{ ok: false }` with a bounded message and does not throw into the frame

### Requirement: Command buffering and capability

The SDK SHALL expose `capabilities.commands` with absence treated as `false`, SHALL queue up to ten `shell/command` messages that arrive before a handler is attached, and SHALL ignore later command messages after disposal.

#### Scenario: Early command

- **WHEN** `shell/command` arrives before the plugin attaches a handler
- **THEN** the SDK queues it up to ten messages and dispatches it when the handler is attached

#### Scenario: Queue overflow

- **WHEN** more than ten commands arrive with no handler attached
- **THEN** the SDK answers the excess with a failure result instead of growing an unbounded queue

#### Scenario: Older shell

- **WHEN** `shell/init` omits `capabilities.commands`
- **THEN** the client reports command delivery as unsupported and `onCommand` sends no message

#### Scenario: Disposal

- **WHEN** the frame is disposed with an invocation in flight
- **THEN** the SDK rejects the handler, sends no result for the disposed invocation and ignores later command messages
