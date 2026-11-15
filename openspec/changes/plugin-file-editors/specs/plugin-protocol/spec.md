# Spec Delta

## ADDED Requirements

### Requirement: Editor eligibility and write permission

The shell SHALL accept or select a file-editor contribution only from a plugin
that declares `workspace:read` (or `workspace:write`, which implies it), SHALL
offer a save only when the plugin declares `workspace:write` and the workspace
session is writable, and SHALL answer any other save attempt with
`permission-denied` without writing.

#### Scenario: Editor contribution without read permission

- **WHEN** a plugin without `workspace:read` or `workspace:write` registers a file editor
- **THEN** that contribution is rejected with `permission-denied` and never enters the registry

#### Scenario: Read-only editor

- **WHEN** a plugin declares `workspace:read` but not `workspace:write`
- **THEN** its editor opens documents, but the shell offers no Save action for them

#### Scenario: Save without write permission

- **WHEN** a read-only editor's document is saved
- **THEN** the shell returns `permission-denied`, performs no write and leaves the document dirty

#### Scenario: Read-only workspace

- **WHEN** the workspace session is not writable
- **THEN** saving a handler document returns `permission-denied`, performs no write and keeps the tab dirty

#### Scenario: Write implies read

- **WHEN** a plugin declares `workspace:write` without `workspace:read`
- **THEN** it is treated as holding read permission and its editor contribution is accepted
