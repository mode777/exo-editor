# Spec Delta

## MODIFIED Requirements

### Requirement: Unsupported document content has no editor

The shell SHALL present an explicit no-editor state for binary, undecodable or oversized files when no plugin editor handles them, and SHALL never write them through the shell text surface.

#### Scenario: Binary file shows no editor

- **WHEN** a file contains NUL bytes in its initial sample and no registered plugin editor matches it
- **THEN** the tab shows a binary/no-editor state with the path and size

#### Scenario: Oversized file shows no editor

- **WHEN** a file exceeds the shell's text read limit and no registered plugin editor matches it
- **THEN** the tab shows a too-large state naming the limit and no content is loaded

#### Scenario: Undecodable file shows no editor

- **WHEN** a file cannot be decoded as UTF-8 and no registered plugin editor matches it
- **THEN** the tab shows the no-editor state instead of replacement characters

#### Scenario: Plugin editor takes precedence

- **WHEN** a file is binary, undecodable or larger than the shell text limit but a registered plugin editor matches it
- **THEN** the shell mounts the plugin editor and does not show the shell text no-editor state

#### Scenario: No-editor files are never written

- **WHEN** a binary or oversized file opens in the shell text surface
- **THEN** no save action is offered for it
