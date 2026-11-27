# Spec Delta

## MODIFIED Requirements

### Requirement: Plugin configuration settings surface

The shell SHALL provide one installed-plugin management surface in the
Extensions view for install by manifest URL, enable, disable, remove and consent
review, and SHALL retain a plugin-debug section in the settings surface for raw
`exo.json` editing, validation issues, runtime status and the plugin log. Both
surfaces SHALL write only through the shell-owned configuration store and the
workspace session, and neither SHALL duplicate the other's controls.

#### Scenario: Declared entries are listed

- **WHEN** the active workspace has a valid `exo.json`
- **THEN** the Extensions Installed section lists every entry with its manifest URL and whether it is enabled, and the settings debug section lists the same entries as status rows

#### Scenario: Add an entry

- **WHEN** the user submits a valid manifest URL from the Extensions view
- **THEN** the entry is written to `exo.json`, appears in Installed enabled, and the rest of the declaration is unchanged

#### Scenario: Add to an empty workspace

- **WHEN** the workspace has no `exo.json` and the user adds the first plugin from Extensions
- **THEN** the shell creates the file, lists the entry, and reports no plugin error

#### Scenario: Add rejects an invalid URL

- **WHEN** the submitted URL is relative, insecure outside `localhost`, contains credentials or contains a fragment
- **THEN** the entry is not added, the file is unchanged, and the reason is shown next to the input

#### Scenario: Add rejects a duplicate

- **WHEN** the submitted URL already exists in the declaration
- **THEN** the entry is not added and the duplicate is reported

#### Scenario: Toggle an entry

- **WHEN** the user disables or enables an entry in Extensions
- **THEN** only that entry's `enabled` value changes and both surfaces show the new state

#### Scenario: Remove an entry

- **WHEN** the user removes an entry in Extensions
- **THEN** only that entry is removed and the remaining entries keep their values

#### Scenario: No workspace

- **WHEN** no workspace is open
- **THEN** Extensions explains that a folder must be open before installing, and Settings explains that plugin status and raw editing need a workspace

#### Scenario: Workspace switch

- **WHEN** the user switches workspaces
- **THEN** both surfaces show only the new workspace's declaration and no entry, detail tab or pending action from the previous workspace

#### Scenario: Adding does not load code

- **WHEN** the user adds an entry from either surface
- **THEN** the host fetches the manifest but mounts no frame or executes plugin code until consent is granted

#### Scenario: One management path

- **WHEN** the user manages a plugin from Extensions or reads it in Settings
- **THEN** Extensions owns add, enable, disable, remove, consent review and contributed settings, while Settings owns raw editing, validation issues, status inspection and the log without repeating the management actions

### Requirement: Configuration states are explicit

The shell SHALL distinguish missing, valid, invalid and read-only configuration
in Extensions and in the settings debug section, SHALL show every issue with its
code and, when known, the entry index and field, SHALL keep the workspace usable
when the declaration is invalid, and SHALL disable add, toggle and remove in
Extensions when the workspace is read-only.

#### Scenario: Missing declaration

- **WHEN** the workspace has no `exo.json`
- **THEN** Extensions shows an explicit empty Installed state with an install action and no error, and Settings shows the empty declaration as valid

#### Scenario: Invalid declaration

- **WHEN** `exo.json` fails validation
- **THEN** both surfaces show each issue with its code, entry index and field, no entry is presented as usable, install and manage are disabled, and the explorer and document area stay usable

#### Scenario: Partial failure lists every issue

- **WHEN** one entry is valid and another is invalid
- **THEN** both surfaces report the invalid entry and do not present either entry as usable

#### Scenario: Over-limit declaration

- **WHEN** `exo.json` declares more than 50 plugins
- **THEN** both surfaces report the limit and no entry is presented as usable

#### Scenario: Read-only workspace

- **WHEN** the workspace session reports `writable: false`
- **THEN** Extensions disables install, toggle and remove, Settings disables raw save, and both explain that the workspace is read-only

#### Scenario: External change is reflected

- **WHEN** `exo.json` changes on disk and the window regains focus
- **THEN** both surfaces show the new entries, issues or missing state

### Requirement: Raw configuration editing stays in the shell

The shell SHALL open `exo.json` as a raw text view inside the settings surface,
never as a document tab, SHALL show the current text, SHALL validate before
writing, SHALL write through the canonical serializer with `ifVersion`, and SHALL
state that comments and formatting are not preserved and that comments are
invalid JSON.

#### Scenario: Open routes to settings

- **WHEN** the user runs Open Plugin Debugging or attempts to open `exo.json` from the explorer or palette
- **THEN** the settings surface opens at the plugin debug section and no document tab is created

#### Scenario: Raw view shows the current file

- **WHEN** the user opens the raw view
- **THEN** it shows the current `exo.json` text when the file is readable, or the canonical empty declaration when the file is missing

#### Scenario: Raw save canonicalizes

- **WHEN** the user saves valid raw text
- **THEN** the shell writes the canonical 2-space form with a trailing newline and updates both Extensions and Settings without a reload

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
- **THEN** the session denies it with `permission-denied` and the shell-owned Extensions and settings surfaces are the only writers

### Requirement: Plugin runtime status, consent and log surface

The Extensions detail view SHALL show the user-facing host status, manifest
identity and consent actions for one plugin, and the settings plugin-debug
section SHALL show a workspace-scoped status table and log of host phases,
command invocations, results and error codes. Both SHALL reset on a workspace
switch and SHALL never include file content.

#### Scenario: Awaiting consent is visible

- **WHEN** a valid manifest has no matching consent record
- **THEN** the Installed row and detail view show `awaiting-consent` with a Review action that opens the consent dialog

#### Scenario: Active plugin shows its editors

- **WHEN** a plugin completes registration with two editor contributions
- **THEN** the installed row shows `active`, its manifest name, version, publisher and exact origin, and the detail view lists both editor labels

#### Scenario: Active plugin shows its commands

- **WHEN** a plugin completes registration with registered commands
- **THEN** the detail view lists their titles and targets alongside the editor labels

#### Scenario: Failure shows code and phase

- **WHEN** a manifest fetch or registration phase fails
- **THEN** the installed row and detail view show `failed`, the stable error code and the phase that failed

#### Scenario: Denied is visible without an automatic retry

- **WHEN** the user denied consent in this session
- **THEN** the installed row and detail view show `denied` and the dialog does not reopen by itself

#### Scenario: Revoke tears down and can be reviewed

- **WHEN** the user revokes consent for an active plugin from the detail view
- **THEN** its registrations and frames disappear, the row and detail view show `awaiting-consent`, and Review can reopen the dialog

#### Scenario: Log entries are inspectable

- **WHEN** host events have occurred for the workspace
- **THEN** the settings debug section lists their time, plugin id or manifest URL, origin, phase and code

#### Scenario: Command results are logged

- **WHEN** a command completes, fails or times out
- **THEN** the log records the command id, the outcome and the bounded message without file content

#### Scenario: Workspace switch resets the surface

- **WHEN** the user switches workspaces
- **THEN** no host status, consent action, detail tab or log entry from the previous workspace remains

#### Scenario: No workspace

- **WHEN** no workspace is open
- **THEN** Extensions keeps catalog browsing and details available, and Settings shows no host status or log and explains that a folder is required

#### Scenario: No file content is displayed

- **WHEN** any host status or log entry is rendered
- **THEN** it contains no file text, bytes, manifest response body or path outside the plugin's declared entries

### Requirement: Plugin primary panels and activity bar

The shell SHALL derive `config.activityBar.items`, `config.primarySideBar.views` and the primary view registry from active plugin registrations, SHALL show the explorer first, then the built-in Extensions view, then primary panels in declaration and registration order, and SHALL switch to a view on activation without forking the workbench preset.

#### Scenario: Primary panel becomes an activity item

- **WHEN** a plugin registers a declared primary panel
- **THEN** the activity bar shows its icon and title after Explorer and Extensions, and activating it opens that panel

#### Scenario: Activity item switches views

- **WHEN** the user activates a different primary panel
- **THEN** the side bar shows that panel and the previous panel is hidden without disposal

#### Scenario: Removal falls back

- **WHEN** the active primary panel is unregistered or its plugin stops
- **THEN** the shell shows the explorer and removes the activity item

#### Scenario: Dynamic configuration

- **WHEN** the plugin host snapshot changes
- **THEN** the shell recomputes the activity items and primary views from the snapshot without reloading the page or patching the preset

#### Scenario: No plugin panels

- **WHEN** no plugin contributes a primary panel
- **THEN** the activity bar contains the shell's explorer, extensions and settings items exactly as before

#### Scenario: Plugin panels keep their order

- **WHEN** two plugins register primary panels
- **THEN** they appear after Extensions in declaration order and then registration order, independent of fetch timing
