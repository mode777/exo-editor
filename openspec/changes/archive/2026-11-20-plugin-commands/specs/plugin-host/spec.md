# Spec Delta

## ADDED Requirements

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
