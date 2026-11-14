# Spec Delta

## MODIFIED Requirements

### Requirement: Workspace plugin declaration

The shell SHALL read plugin declarations from `exo.json` at the workspace root
with a `schemaVersion` of `1` and a `plugins` array of at most 50 entries, each
carrying an absolute `https` manifest URL (or `http://localhost`) with no
credentials or fragment and an optional `enabled` flag defaulting to `true`. Any
validation failure SHALL yield zero usable entries and a stable per-entry error
with its index and field; a missing file SHALL mean zero plugins, not an error.

#### Scenario: Unknown fields are rejected

- **WHEN** `exo.json` contains an unknown top-level or plugin-entry field
- **THEN** validation fails with `invalid-config`, the failing field is named, and no entry is usable

#### Scenario: Missing file means no plugins

- **WHEN** the workspace has no `exo.json`
- **THEN** the shell reports zero plugins and opens the workspace without an error

#### Scenario: Malformed file disables loading

- **WHEN** `exo.json` is not valid JSON or fails validation
- **THEN** zero usable entries remain, the workspace stays usable, and the problem is shown with the file path and each failing entry

#### Scenario: Partial failure is all-or-nothing

- **WHEN** `exo.json` contains one valid entry and one invalid entry
- **THEN** the invalid entry is reported with `invalid-config` and neither entry is usable

#### Scenario: Entry limit

- **WHEN** `exo.json` declares more than 50 plugins
- **THEN** the shell reports `too-many-plugins` with zero usable entries rather than truncating the list

#### Scenario: Duplicate manifests

- **WHEN** two entries name the same manifest URL
- **THEN** both are reported as `duplicate-manifest` and no entry is usable

#### Scenario: Invalid manifest URL

- **WHEN** an entry's manifest URL is relative, uses `http` on a host other than
  `localhost`, contains credentials or contains a fragment
- **THEN** that entry is reported with `invalid-config` and no entry is usable

#### Scenario: Invalid enabled value

- **WHEN** an entry's `enabled` value is present but not a boolean
- **THEN** that entry is reported with `invalid-config` and no entry is usable

#### Scenario: Live add and remove

- **WHEN** an enabled entry is added to or removed from `exo.json` while the workspace is ready
- **THEN** the added plugin initializes immediately and the removed plugin is torn down immediately

## ADDED Requirements

### Requirement: Configuration loading and refresh

The shell SHALL load the declaration through the shell side of the workspace
session when a workspace becomes ready, SHALL update it after every shell write
and on window focus or visibility, SHALL skip content whose stat version is
unchanged, SHALL cap the file at 256 KiB, and SHALL reset configuration state on
a workspace switch so a late result cannot update the next workspace.

#### Scenario: Load on workspace ready

- **WHEN** a workspace becomes ready
- **THEN** the shell reads `/exo.json` once through the shell side of the session and publishes the resulting configuration state

#### Scenario: Focus refresh picks up an external edit

- **WHEN** `exo.json` changes on disk and the window regains focus or becomes visible
- **THEN** the shell reads the new content and replaces the previous entries

#### Scenario: Unchanged version is not re-read

- **WHEN** a refresh finds the same stat version that was loaded last
- **THEN** the shell does not read or re-parse the file and publishes no change

#### Scenario: Shell write updates the state

- **WHEN** the settings surface writes `exo.json`
- **THEN** the shell publishes the written declaration without a focus refresh

#### Scenario: Invalid external edit disables entries

- **WHEN** an external edit makes `exo.json` invalid while the workspace is ready
- **THEN** the next refresh publishes an invalid state with zero usable entries and the workspace stays usable

#### Scenario: Workspace switch resets the declaration

- **WHEN** the user switches from workspace A to workspace B
- **THEN** A's entries and issues are gone, and a late read from A cannot update B

#### Scenario: Oversized file is rejected

- **WHEN** `exo.json` exceeds 256 KiB
- **THEN** the shell reports `too-large`, uses zero entries, and keeps the rest of the workspace usable

#### Scenario: Unreadable file is reported

- **WHEN** reading `exo.json` fails with a permission or I/O error
- **THEN** the shell reports `not-readable`, uses zero entries, and keeps the rest of the workspace usable

#### Scenario: No manifest request

- **WHEN** the shell loads or refreshes the declaration
- **THEN** it makes no network request to any manifest URL and creates no iframe

### Requirement: Configuration error vocabulary

The shell SHALL report configuration problems as `invalid-json`,
`unsupported-version`, `invalid-config`, `too-many-plugins`,
`duplicate-manifest`, `too-large`, `not-readable` or `conflict`, each with the
file path, the failing JSON Pointer when known, and the entry index when the
problem belongs to one entry, and SHALL not include raw file content in the
diagnostic.

#### Scenario: Parse failure

- **WHEN** the file is not valid JSON
- **THEN** the diagnostic code is `invalid-json` and no entries are usable

#### Scenario: Unknown schema version

- **WHEN** `schemaVersion` is not `1`
- **THEN** the diagnostic code is `unsupported-version` and the document is not partially parsed

#### Scenario: Shape and field failures

- **WHEN** a required field is missing, a value has the wrong type or an unknown field is present
- **THEN** the diagnostic code is `invalid-config` and the failing JSON Pointer is included

#### Scenario: Limit failure

- **WHEN** the declaration has more than 50 entries
- **THEN** the diagnostic code is `too-many-plugins` and no entry is usable

#### Scenario: Duplicate failure

- **WHEN** two entries name the same manifest URL
- **THEN** the diagnostic code is `duplicate-manifest` and both entry indices are included

#### Scenario: Size failure

- **WHEN** the file exceeds 256 KiB
- **THEN** the diagnostic code is `too-large`

#### Scenario: Read failure

- **WHEN** the file cannot be read because of a permission or I/O error
- **THEN** the diagnostic code is `not-readable`

#### Scenario: Stale write

- **WHEN** a write is attempted with a version that no longer matches the file
- **THEN** the diagnostic code is `conflict` and the file is unchanged

#### Scenario: Diagnostics contain no content

- **WHEN** any configuration problem is reported
- **THEN** the diagnostic names the path, code, pointer and entry but never includes raw file text

### Requirement: Canonical configuration rewrite

The shell SHALL write `exo.json` only through the workspace session, SHALL
serialize it as 2-space JSON with `schemaVersion` before `plugins` and `manifest`
before `enabled`, SHALL write `enabled` explicitly, SHALL end with a newline,
SHALL validate before writing, and SHALL use the loaded version as `ifVersion` so
a stale rewrite fails with `conflict` instead of overwriting an external edit.

#### Scenario: Canonical bytes

- **WHEN** the shell writes a declaration
- **THEN** the file is 2-space JSON with `schemaVersion` before `plugins`, `manifest` before `enabled`, and a trailing newline

#### Scenario: Enabled is explicit

- **WHEN** an entry omits `enabled` and is written by the shell
- **THEN** the canonical file includes `"enabled": true`

#### Scenario: Missing file is created

- **WHEN** the user adds the first plugin to a workspace without `exo.json`
- **THEN** the shell creates `/exo.json` with `schemaVersion: 1` and the new entry

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
- **THEN** the file is canonicalized and the settings surface states that formatting and key order are not preserved

#### Scenario: Comments are not valid JSON

- **WHEN** `exo.json` contains comments
- **THEN** validation reports `invalid-json` and the shell does not strip the comments or write the file
