# Spec Delta

## ADDED Requirements

### Requirement: Plugin configuration settings surface

The shell SHALL provide a Plugins section in its settings surface that lists each
declared plugin with its manifest URL and enabled state, adds an entry by
manifest URL, toggles `enabled`, and removes an entry, all through the shell-owned
configuration store and the workspace session.

#### Scenario: Declared entries are listed

- **WHEN** the active workspace has a valid `exo.json`
- **THEN** the Plugins section lists every entry with its manifest URL and whether it is enabled

#### Scenario: Add an entry

- **WHEN** the user submits a valid manifest URL
- **THEN** the entry is written to `exo.json`, appears in the list enabled, and the rest of the declaration is unchanged

#### Scenario: Add to an empty workspace

- **WHEN** the workspace has no `exo.json` and the user adds the first plugin
- **THEN** the shell creates the file, lists the entry, and reports no plugin error

#### Scenario: Add rejects an invalid URL

- **WHEN** the submitted URL is relative, insecure outside `localhost`, contains credentials or contains a fragment
- **THEN** the entry is not added, the file is unchanged, and the reason is shown on the input

#### Scenario: Add rejects a duplicate

- **WHEN** the submitted URL already exists in the declaration
- **THEN** the entry is not added and the duplicate is reported

#### Scenario: Toggle an entry

- **WHEN** the user disables or enables an entry
- **THEN** only that entry's `enabled` value changes and the list shows the new state

#### Scenario: Remove an entry

- **WHEN** the user removes an entry
- **THEN** only that entry is removed and the remaining entries keep their values

#### Scenario: No workspace

- **WHEN** no workspace is open
- **THEN** the Plugins section explains that a folder must be open and offers no edit that would need a workspace

#### Scenario: Workspace switch

- **WHEN** the user switches workspaces
- **THEN** the section shows only the new workspace's declaration and no entry from the previous workspace

#### Scenario: Adding does not load code

- **WHEN** the user adds an entry
- **THEN** the shell makes no request to the manifest URL, creates no frame, and shows no consent prompt

### Requirement: Configuration states are explicit

The shell SHALL distinguish missing, valid, invalid and read-only configuration in
the Plugins section, SHALL show every issue with its code and, when known, the
entry index and field, SHALL keep the workspace usable when the declaration is
invalid, and SHALL disable add, toggle and remove when the workspace is read-only.

#### Scenario: Missing declaration

- **WHEN** the workspace has no `exo.json`
- **THEN** the section shows an explicit empty state with an add action and no error

#### Scenario: Invalid declaration

- **WHEN** `exo.json` fails validation
- **THEN** the section shows each issue with its code, entry index and field, no entry is presented as usable, and the explorer and document area stay usable

#### Scenario: Partial failure lists every issue

- **WHEN** one entry is valid and another is invalid
- **THEN** the section reports the invalid entry and does not present either entry as usable

#### Scenario: Over-limit declaration

- **WHEN** `exo.json` declares more than 50 plugins
- **THEN** the section reports the limit and no entry is presented as usable

#### Scenario: Read-only workspace

- **WHEN** the workspace session reports `writable: false`
- **THEN** add, toggle, remove and raw save are disabled and the section explains that the workspace is read-only

#### Scenario: External change is reflected

- **WHEN** `exo.json` changes on disk and the window regains focus
- **THEN** the section shows the new entries, issues or missing state

### Requirement: Raw configuration editing stays in the shell

The shell SHALL open `exo.json` as a raw text view inside the settings surface,
never as a document tab, SHALL show the current text, SHALL validate before
writing, SHALL write through the canonical serializer with `ifVersion`, and SHALL
state that comments and formatting are not preserved and that comments are
invalid JSON.

#### Scenario: Open routes to settings

- **WHEN** the user runs Open Plugin Configuration or attempts to open `exo.json` from the explorer or palette
- **THEN** the settings surface opens at the Plugins section and no document tab is created

#### Scenario: Raw view shows the current file

- **WHEN** the user opens the raw view
- **THEN** it shows the current `exo.json` text when the file is readable, or the canonical empty declaration when the file is missing

#### Scenario: Raw save canonicalizes

- **WHEN** the user saves valid raw text
- **THEN** the shell writes the canonical 2-space form with a trailing newline and updates the list without a reload

#### Scenario: Raw save rejects invalid text

- **WHEN** the raw text is not valid JSON or fails validation
- **THEN** the shell writes nothing, reports the issues, and leaves the previous file and list intact

#### Scenario: Raw save detects an external edit

- **WHEN** the file changed after the raw view loaded and the user saves
- **THEN** the save fails with `conflict`, the external content is preserved, and the view reports the conflict and offers to reload it without discarding the user's text

#### Scenario: Formatting and comment warning

- **WHEN** the user opens the raw view or triggers a structured edit
- **THEN** the surface states that saving writes canonical JSON, does not preserve comments, formatting or key order, and that comments are not valid JSON

#### Scenario: No plugin path edits the file

- **WHEN** a plugin requests a read or write of `/exo.json`
- **THEN** the session denies it with `permission-denied` and the settings surface is the only writer
