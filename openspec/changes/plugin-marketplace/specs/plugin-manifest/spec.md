# Spec Delta

## MODIFIED Requirements

### Requirement: Canonical configuration rewrite

The shell SHALL write `exo.json` only through the workspace session, SHALL
serialize it as 2-space JSON with `schemaVersion` before `plugins` and `manifest`
before `enabled`, SHALL write `enabled` explicitly, SHALL end with a newline,
SHALL validate before writing, and SHALL use the loaded version as `ifVersion` so
a stale rewrite fails with `conflict` instead of overwriting an external edit.
Only the shell-owned Extensions management surface and the settings raw-edit
surface SHALL write the declaration.

#### Scenario: Canonical bytes

- **WHEN** the shell writes a declaration
- **THEN** the file is 2-space JSON with `schemaVersion` before `plugins`, `manifest` before `enabled`, and a trailing newline

#### Scenario: Enabled is explicit

- **WHEN** an entry omits `enabled` and is written by the shell
- **THEN** the canonical file includes `"enabled": true`

#### Scenario: Missing file is created

- **WHEN** the user installs the first plugin from the Extensions view or adds it in the raw editor to a workspace without `exo.json`
- **THEN** the shell creates `/exo.json` with `schemaVersion: 1` and the new entry

#### Scenario: Marketplace install writes one entry

- **WHEN** the user installs a catalog entry
- **THEN** the shell appends exactly one enabled entry with that manifest URL and preserves every existing entry, flag and field value

#### Scenario: Invalid content is not written

- **WHEN** a rewrite would produce an invalid document
- **THEN** the shell writes nothing and reports the validation issues

#### Scenario: Stale rewrite does not overwrite

- **WHEN** the file changed after it was loaded and the shell attempts a rewrite with the old version
- **THEN** the write fails with `conflict`, the external content is preserved, and the shell reloads it

#### Scenario: Intended change only

- **WHEN** an already-canonical declaration is changed by adding, removing, enabling or disabling one entry
- **THEN** the diff contains only that entry or flag and no unrelated field changes

#### Scenario: Formatting is normalized

- **WHEN** a valid declaration with different indentation or key order is rewritten
- **THEN** the file is canonicalized and the writing surface states that formatting and key order are not preserved

#### Scenario: Comments are not valid JSON

- **WHEN** `exo.json` contains comments
- **THEN** validation reports `invalid-json` and the shell does not strip the comments or write the file

#### Scenario: Catalog metadata does not enter the declaration

- **WHEN** a marketplace entry supplies a name, version, publisher or description
- **THEN** the write contains only the entry's `manifest` and `enabled` fields and none of the feed metadata
