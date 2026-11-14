# editor-shell Specification

## Purpose
Defines the shell as the product: a static, backend-free workbench that composes
the reused workbench kit, owns the workspace and plugin surfaces, and gives no
editor privileged access.

## Requirements

### Requirement: Static, backend-free delivery

The shell SHALL be deliverable as static assets with no server-side runtime, API
proxy, account system or secret in the client bundle, and SHALL publish through a
push-triggered GitHub Pages workflow.

#### Scenario: Deployed artifact is static

- **WHEN** the production build output is inspected
- **THEN** it consists of HTML, JavaScript, CSS and asset files, makes no request to a first-party API, and contains no credential

#### Scenario: Push deploys, pull request verifies

- **WHEN** a commit lands on the main branch
- **THEN** the workflow builds and publishes the site, while a pull request runs the same checks without deploying

### Requirement: Shell content security policy

The deployed shell SHALL apply a CSP with
`frame-src https: http://localhost:*`,
`connect-src 'self' https: http://localhost:*` and `script-src 'self'`, and no
`unsafe-eval` or `unsafe-inline` script sources. The localhost sources exist only
for the manifest contract's localhost rule; no other plain-HTTP origin is
allowed. The policy SHALL be embedded in the HTML document and present in the
deployed build.

#### Scenario: Policy is embedded in the deployed document

- **WHEN** the deployed shell's HTML document is fetched
- **THEN** it carries a content security policy with `frame-src https: http://localhost:*`,
  `connect-src 'self' https: http://localhost:*` and `script-src 'self'`, and no
  `unsafe-eval` or `unsafe-inline` script source

#### Scenario: Plugin code stays in its frame

- **WHEN** a plugin manifest or entry tries to inject script into the shell
- **THEN** the CSP blocks it and the plugin remains confined to its iframe

#### Scenario: No evaluation

- **WHEN** the shell handles plugin-supplied data
- **THEN** it does not pass it to `eval`, `new Function` or an equivalent dynamic
  evaluation API

#### Scenario: Localhost manifest is usable

- **WHEN** a declaration points at `http://localhost:5174/exo-manifest.json`
- **THEN** the deployed shell can fetch the manifest and frame the entry page after consent

#### Scenario: Other plain HTTP stays blocked

- **WHEN** a manifest or entry uses `http://` on a host other than `localhost`
- **THEN** the shell rejects it and the CSP does not allow the request

### Requirement: Shell composes the workbench kit

The shell SHALL depend on the published `vscode-workbench` package and compose it
through public exports and preset props (`views`, `renderDocument`, `commands`,
`menus`, `quickOpen`, `fileIcons`, `statusBar`, `initialSession`), and SHALL
supply its own explorer, document area and commands. It SHALL NOT copy, vendor or
patch upstream demo modules or preset source.

#### Scenario: No upstream demo dependency

- **WHEN** the shell source is searched for upstream demo views, mock workspace data or vendored preset source
- **THEN** none are present, and the only upstream imports are from the published package's public entry points

#### Scenario: Explorer is Exo-owned

- **WHEN** a workspace is open in the shell
- **THEN** the explorer renders the workspace provider's tree and never the upstream mock tree

#### Scenario: Kit upgrade is a dependency change

- **WHEN** the pinned `vscode-workbench` minor is upgraded
- **THEN** the composition compiles and the shell verifies its props against the package's public types without editing vendored code

### Requirement: No editor is privileged

No editor implementation SHALL be compiled into the shell bundle or receive
privileged access to shell state, and the reference code editor SHALL load only
through the plugin protocol.

#### Scenario: Shell bundle excludes the reference editor

- **WHEN** the shell bundle is inspected
- **THEN** it contains no Monaco code, and the reference editor is a separately deployed plugin

#### Scenario: Disabling the reference editor degrades cleanly

- **WHEN** the reference editor plugin is disabled in settings
- **THEN** matching files fall back to the shell-owned document renderer and no privileged code path remains active

### Requirement: Workspace switch resets workspace-scoped state

Loading a different workspace SHALL reset open tabs, plugin registrations,
handler sessions, watchers, caches, event subscriptions and workspace-scoped
settings, while retaining global layout and theme preferences. A callback
belonging to a released workspace SHALL NOT be able to mutate shell state.

#### Scenario: Nothing survives a switch

- **WHEN** a user switches from workspace A to workspace B
- **THEN** no tab, registration, handler session, watcher, cached file or plugin setting from A is observable in B

#### Scenario: Late callback is dropped

- **WHEN** a workspace operation or watcher callback from A resolves after B is ready
- **THEN** the shell ignores it and B's state is unchanged

### Requirement: Workspace configuration is shell-only

`exo.json` at the workspace root and everything under `/.exo/` SHALL be readable
and writable only by shell code, and no plugin-facing API, message or document
path SHALL expose them.

#### Scenario: Plugin cannot read the declaration

- **WHEN** a plugin requests `/exo.json` or any path under `/.exo/`
- **THEN** the shell rejects the request with `permission-denied` and returns no content or metadata

#### Scenario: Declaration is not openable as a document

- **WHEN** the explorer or command palette attempts to open `exo.json` as a normal document
- **THEN** the shell routes to the plugin settings surface instead of creating an editable tab

#### Scenario: Shell may edit the declaration

- **WHEN** the user changes plugin configuration through the shell's settings UI
- **THEN** the shell reads and rewrites the file directly and no plugin participates in the write

### Requirement: Empty shell is a usable workbench

The deployed shell SHALL render a usable workbench with no workspace open: the
chrome fills the viewport with no body scroll, the primary surfaces are
operable by keyboard, and the explorer shows an explicit empty state.

#### Scenario: Renders at desktop and narrow widths

- **WHEN** the deployed URL is opened at 1440x900 and at a narrow width
- **THEN** the workbench renders fully within the viewport with no body scroll at either size

#### Scenario: Keyboard operable

- **WHEN** the user navigates the shell by keyboard alone
- **THEN** focus moves through the shell's primary surfaces and the command palette opens and closes from the keyboard

#### Scenario: Explorer is explicitly empty

- **WHEN** no workspace is open
- **THEN** the explorer shows an explicit empty state with no file tree and no mock workspace data

### Requirement: Layout session persists

The shell SHALL persist its layout session - panel and region visibility, sash
sizes and the active theme - and SHALL restore it when the page is reloaded.
Layout and theme are global preferences and SHALL survive a workspace switch
even though workspace-scoped state is reset (D7).

#### Scenario: Reload restores the layout

- **WHEN** the user changes the layout or theme and reloads the page
- **THEN** the shell comes back with the same layout and theme

#### Scenario: Theme survives a workspace switch

- **WHEN** the user switches workspaces after changing the theme
- **THEN** the theme preference is unchanged while workspace-scoped state is reset

### Requirement: Baseline commands work without a workspace

The shell SHALL offer the commands that need no workspace when none is open -
toggling the theme and opening the shell's settings surface - with palette
entries for them.

#### Scenario: Palette offers workspace-free entries

- **WHEN** no workspace is open and the command palette is opened
- **THEN** theme toggle and settings are listed and invoking them changes the theme and opens the shell's settings surface respectively

#### Scenario: Theme toggle applies immediately

- **WHEN** the user invokes the theme toggle
- **THEN** the shell switches to the other theme immediately without a reload

### Requirement: Bundle size budget is enforced

The build SHALL measure the production bundle against a committed size budget,
and the verification pipeline SHALL fail when the bundle exceeds it, so no size
regression lands silently.

#### Scenario: Budget blocks regressions

- **WHEN** the production bundle exceeds the committed budget
- **THEN** the pipeline fails and reports which measured sizes exceeded the budget

#### Scenario: Budget check runs on every pull request

- **WHEN** a pull request is opened
- **THEN** the pipeline builds the bundle and runs the budget check as part of the required gates

### Requirement: Open a folder-backed workspace

The shell SHALL open one user-picked folder as the active workspace through the session, show its name and capabilities, and leave the current workspace untouched when the picker is cancelled. Without a folder picker it SHALL show an explicit unsupported state.

#### Scenario: Picked folder opens

- **WHEN** the user runs Open Folder and picks a directory
- **THEN** the explorer lists the selected root and the status bar shows the folder name

#### Scenario: Cancellation is silent

- **WHEN** the user cancels the directory picker
- **THEN** no error is reported and the previous workspace, if any, remains active

#### Scenario: Switching disposes the old workspace first

- **WHEN** a folder is picked while another workspace is open
- **THEN** the old session is disposed before the new tree renders and no tab from the old workspace remains

#### Scenario: Unsupported browser is explicit

- **WHEN** the browser has no directory picker
- **THEN** Open Folder explains the limitation and no fabricated workspace or file tree appears

#### Scenario: Picker failure is actionable

- **WHEN** the picker rejects with a permission or security failure
- **THEN** the shell reports an actionable message and does not change the active workspace

### Requirement: Restore the last workspace

The shell SHALL restore the last opened workspace after a reload from its persisted directory handle and SHALL present it read-only with an explicit restore-access action until write permission is granted in a user gesture.

#### Scenario: Silent restore with permission

- **WHEN** the page reloads and the stored handle still has read-write permission
- **THEN** the workspace restores with the same identity and writable capability without prompting

#### Scenario: Read-only restore without write permission

- **WHEN** the page reloads and write permission must be requested again
- **THEN** the workspace restores read-only, editing and mutation actions are disabled, and a banner offers Restore access

#### Scenario: Restore access requires a user gesture

- **WHEN** the user activates Restore access
- **THEN** the shell requests write permission from that action and enables editing only if it is granted

#### Scenario: Missing handle is cleared

- **WHEN** the stored handle is absent or the folder cannot be reopened
- **THEN** the shell clears the stored record, starts with no workspace, and explains why

### Requirement: Explorer reflects the active workspace

The explorer SHALL list the active workspace lazily, update after shell-originated create, rename and delete, hide shell-only entries, and disable mutating actions when the session is not writable.

#### Scenario: Directories expand and collapse

- **WHEN** the user expands a directory
- **THEN** its children are listed from the session, directories sort before files, and collapsing it removes the children from the visible tree

#### Scenario: Create, rename and delete

- **WHEN** the user creates a file or folder, renames an entry or deletes an entry
- **THEN** the session performs the operation and the explorer shows the resulting tree without a full reload

#### Scenario: Shell-only entries are not openable

- **WHEN** the workspace root contains `exo.json` or `/.exo`
- **THEN** neither is offered as an openable document, and `/exo.json` is not shown as a file the explorer can edit

#### Scenario: Read-only workspace disables mutation

- **WHEN** the session reports `writable: false`
- **THEN** new, rename and delete actions are disabled and the explorer explains that the workspace is read-only

#### Scenario: Focus refreshes visible directories

- **WHEN** the window regains focus and a visible directory changed outside the shell
- **THEN** the explorer re-lists that directory and shows the new entries

### Requirement: Explorer keyboard operation

The explorer SHALL be operable from the keyboard: moving between rows, expanding and collapsing, opening files, renaming and deleting, with focus kept on a valid row after the tree changes.

#### Scenario: Arrow keys move and expand

- **WHEN** the explorer has focus and the user presses Arrow Up, Arrow Down, Arrow Right or Arrow Left
- **THEN** focus moves to the adjacent row or expands and collapses the focused directory

#### Scenario: Enter opens or toggles

- **WHEN** the user presses Enter on a focused file or directory
- **THEN** the file opens in a tab or the directory toggles expansion

#### Scenario: Rename and delete from the keyboard

- **WHEN** the user presses F2 or Delete on a focused entry
- **THEN** rename starts inline or the delete confirmation opens, respectively

#### Scenario: Focus survives a tree change

- **WHEN** an entry is deleted or renamed
- **THEN** focus moves to a valid sibling or parent instead of being lost

### Requirement: Workspace commands

The shell SHALL expose Open Folder with or without a workspace and Save for the active text document, including command-palette entries, and SHALL omit actions that cannot apply instead of showing enabled no-ops.

#### Scenario: Open Folder is always available

- **WHEN** no workspace is open and the command palette is opened
- **THEN** Open Folder is listed and starts the folder picker

#### Scenario: Save targets the active document

- **WHEN** a dirty text document is active and the user runs Save
- **THEN** the document writes through the session and clears its dirty state on success

#### Scenario: Inapplicable actions are omitted

- **WHEN** no text document is active
- **THEN** Save is not offered as a runnable palette entry

### Requirement: Text documents open and save

The shell SHALL provide a text document surface that reads bytes through the session, edits decoded UTF-8, and saves the exact bytes with the loaded version as `ifVersion`. Editing state SHALL be owned by that surface, and no file handle SHALL reach it.

#### Scenario: Open a 1 MiB text file

- **WHEN** the user opens a 1 MiB UTF-8 text file
- **THEN** the tab shows the decoded content and the surface receives the path and bytes, not a file or directory handle

#### Scenario: Save round-trips exact bytes

- **WHEN** the user edits and saves a text document
- **THEN** the written bytes equal the edited content and the returned stat becomes the new loaded version

#### Scenario: Save uses the loaded version

- **WHEN** the file changed on disk after it was loaded
- **THEN** the save fails with `conflict`, the newer disk content remains, and the tab stays dirty

#### Scenario: Read failure is recoverable

- **WHEN** opening a file fails with `not-found` or `permission-denied`
- **THEN** the tab shows an actionable error with Retry and no empty document is presented as the file's content

### Requirement: Dirty documents are protected

The shell SHALL show a dirty indicator for an edited document, prompt with save, discard and cancel before closing or replacing a dirty tab, and warn on page unload while any document is dirty.

#### Scenario: Dirty indicator is visible

- **WHEN** the user changes a document's text
- **THEN** the tab shows a dirty indicator and the indicator clears only after a successful save or reload

#### Scenario: Closing a dirty tab prompts

- **WHEN** the user closes a dirty tab
- **THEN** the shell offers Save, Discard and Cancel and does not remove the tab until the choice resolves

#### Scenario: Cancel keeps the document

- **WHEN** the user chooses Cancel in the close prompt
- **THEN** the tab, content and dirty state are unchanged

#### Scenario: Save then close

- **WHEN** the user chooses Save in the close prompt and the save succeeds
- **THEN** the tab closes and the saved content remains on disk

#### Scenario: Discard closes without writing

- **WHEN** the user chooses Discard in the close prompt
- **THEN** the tab closes and no write reaches the provider

#### Scenario: Closing several dirty tabs is protected

- **WHEN** the user closes all tabs or another tab while more than one document is dirty
- **THEN** every dirty document is resolved by the prompt before any of them is removed

#### Scenario: Unload warns about unsaved work

- **WHEN** the page is reloaded or closed while a document is dirty
- **THEN** the browser receives a before-unload warning

### Requirement: External changes are visible

The shell SHALL show an external-change notice when a refresh finds an open document's version changed or the file deleted, and SHALL preserve local edits until the user chooses to reload or keep them.

#### Scenario: Clean document offers reload

- **WHEN** a clean open document changes on disk
- **THEN** the document shows an external-change notice with a Reload action and does not discard the tab

#### Scenario: Dirty document keeps local edits

- **WHEN** a dirty open document changes on disk
- **THEN** the shell keeps the local edits, shows the notice, and a save surfaces `conflict` instead of overwriting

#### Scenario: Deleted file is reported

- **WHEN** an open document is deleted outside the shell
- **THEN** the tab shows a deleted-file notice and no save recreates it

#### Scenario: Late refresh cannot mutate the next workspace

- **WHEN** a refresh from a released workspace resolves after a switch
- **THEN** the shell ignores it and the new workspace state is unchanged

### Requirement: Unsupported document content has no editor

The shell SHALL present an explicit no-editor state for binary, undecodable or oversized files and SHALL never write them through the text surface.

#### Scenario: Binary file shows no editor

- **WHEN** a file contains NUL bytes in its initial sample
- **THEN** the tab shows a binary/no-editor state with the path and size

#### Scenario: Oversized file shows no editor

- **WHEN** a file exceeds the shell's text read limit
- **THEN** the tab shows a too-large state naming the limit and no content is loaded

#### Scenario: Undecodable file shows no editor

- **WHEN** a file cannot be decoded as UTF-8
- **THEN** the tab shows the no-editor state instead of replacement characters

#### Scenario: No-editor files are never written

- **WHEN** a binary or oversized file is open
- **THEN** no save action is offered for it

### Requirement: Open documents follow rename and delete

The shell SHALL keep an open document attached to its file across rename and SHALL close it on delete without allowing a later save to recreate the file.

#### Scenario: Rename updates the open tab

- **WHEN** the user renames the open file
- **THEN** the tab title and path update to the new name and no second tab appears

#### Scenario: Dirty document saves to the new path

- **WHEN** a dirty open document is renamed
- **THEN** its next save writes to the new path with the move's returned version

#### Scenario: Deleting the open file closes its tab

- **WHEN** the user deletes the open file and the document is clean
- **THEN** the tab closes and the document state is dropped

#### Scenario: Deleting a dirty file is confirmed

- **WHEN** the user deletes the open file and the document is dirty
- **THEN** the shell confirms the loss before deleting, and a confirmed delete removes the tab

#### Scenario: Delete cancels an in-flight save

- **WHEN** the open file is deleted while its save is in flight
- **THEN** the save does not recreate the file and the tab does not reappear

### Requirement: Workspace failures are scoped

The shell SHALL report workspace failures in the surface they affect, naming the workspace or path, and SHALL clear them when the workspace changes; it SHALL not use a global notification that obscures which folder failed.

#### Scenario: Directory listing failure is inline

- **WHEN** listing a directory fails
- **THEN** that directory shows the failure and a Retry action while the rest of the explorer stays usable

#### Scenario: Save failure stays with the document

- **WHEN** a save fails
- **THEN** the document shows the failure, keeps its content and dirty state, and the error does not replace the explorer

#### Scenario: Permission loss is a workspace banner

- **WHEN** the session reports `permission-denied` for workspace access
- **THEN** a banner on the workspace surface explains the lost permission and offers the recovery action

#### Scenario: Switching clears the previous failure

- **WHEN** the user switches workspaces
- **THEN** no error banner or message from the previous workspace remains

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
- **THEN** the host fetches the manifest but mounts no frame or executes plugin code until consent is granted

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

### Requirement: Plugin runtime status, consent and log surface

The Plugins section SHALL show, for each declared entry, the host status,
manifest name, version, publisher and exact origin when known, the consent state
with review or revoke actions, and the registered editor labels, and SHALL show a
workspace-scoped log of host phases and error codes. Status and log SHALL reset
on a workspace switch and SHALL never include file content.

#### Scenario: Awaiting consent is visible

- **WHEN** a valid manifest has no matching consent record
- **THEN** the entry shows `awaiting-consent` and a Review action that opens the consent dialog

#### Scenario: Active plugin shows its editors

- **WHEN** a plugin completes registration with two editor contributions
- **THEN** the entry shows `active`, its manifest name, version, publisher, exact origin and both editor labels

#### Scenario: Failure shows code and phase

- **WHEN** a manifest fetch or registration phase fails
- **THEN** the entry shows `failed`, the stable error code and the phase that failed

#### Scenario: Denied is visible without an automatic retry

- **WHEN** the user denied consent in this session
- **THEN** the entry shows `denied` and the dialog does not reopen by itself

#### Scenario: Revoke tears down and can be reviewed

- **WHEN** the user revokes consent for an active plugin
- **THEN** its registrations and frames disappear, the entry shows `awaiting-consent`, and Review can reopen the dialog

#### Scenario: Log entries are inspectable

- **WHEN** host events have occurred for the workspace
- **THEN** the section lists their time, plugin id or manifest URL, origin, phase and code

#### Scenario: Workspace switch resets the surface

- **WHEN** the user switches workspaces
- **THEN** no host status, consent action or log entry from the previous workspace remains

#### Scenario: No workspace

- **WHEN** no workspace is open
- **THEN** the section shows no host status or log and explains that a folder is required

#### Scenario: No file content is displayed

- **WHEN** any host status or log entry is rendered
- **THEN** it contains no file text, bytes, manifest response body or path outside the plugin's declared entries
