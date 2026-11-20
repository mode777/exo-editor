# Spec Delta

## ADDED Requirements

### Requirement: Create-only writes

The session SHALL accept a `createOnly` write option and SHALL pass it to the provider. A create-only write SHALL fail with `already-exists` when the target exists at the time of the provider's check, SHALL NOT truncate or overwrite that target, and SHALL create parent directories only when `create` is also requested.

#### Scenario: Create a new file

- **WHEN** a create-only write targets a path that does not exist and its parent exists
- **THEN** the provider creates the file, writes the bytes and returns a new stat with a new version

#### Scenario: Existing target

- **WHEN** a create-only write targets an existing file
- **THEN** the write fails with `already-exists`, the existing bytes are unchanged and no truncation occurs

#### Scenario: Directory target

- **WHEN** a create-only write targets an existing directory
- **THEN** the write fails with `not-a-file` and writes nothing

#### Scenario: Parent creation

- **WHEN** a create-only write also requests `create` and the parent directory is missing
- **THEN** the provider creates the parent directories and the file

#### Scenario: No partial file on failure

- **WHEN** a create-only write fails after opening a handle or starting a remote request
- **THEN** no empty or partial file is visible and the existing state is unchanged

#### Scenario: Normal writes are unchanged

- **WHEN** a write omits `createOnly`
- **THEN** it keeps the existing create, overwrite and `ifVersion` behavior

### Requirement: Create-only provider parity

The memory provider SHALL use an atomic conditional create. The local folder and
Stratofold providers SHALL use their best available check and SHALL document the
residual check-to-write race; the shell SHALL NOT claim an atomic guarantee the
provider cannot enforce. A create-only write SHALL never truncate a target that
existed at check time.

#### Scenario: Atomic create

- **WHEN** the memory provider performs a create-only write and another writer creates the target between operations
- **THEN** the create fails with `already-exists` and leaves that writer's content intact

#### Scenario: Folder residual race

- **WHEN** the local folder provider cannot use an atomic create primitive and an external writer creates the target between its check and its write
- **THEN** the provider documents the residual race in its provider note and the shell does not claim an atomic guarantee it cannot enforce

#### Scenario: Stratofold residual race

- **WHEN** the Stratofold provider cannot express a target-absent conditional upload
- **THEN** it pre-checks, reports `already-exists` for a target observed at check time, documents the residual race, and never treats `If-Match: "*"` as create-only

#### Scenario: Remote provider parity

- **WHEN** the conformance suite runs the create-only cases against the memory, folder and Stratofold providers
- **THEN** all three return the same paths and error codes, and the existing content is unchanged when the target exists

#### Scenario: Remote conditional upload

- **WHEN** the Stratofold provider performs an update with a known version
- **THEN** it uses its conditional upload rather than an unconditional overwrite
