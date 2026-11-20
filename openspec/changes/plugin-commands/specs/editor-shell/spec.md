# Spec Delta

## MODIFIED Requirements

### Requirement: Plugin runtime status, consent and log surface

The Plugins section SHALL show, for each declared entry, the host status,
manifest name, version, publisher and exact origin when known, the consent state
with review or revoke actions, and the registered editor labels and command
titles, and SHALL show a workspace-scoped log of host phases, command
invocations, results and error codes. Status and log SHALL reset on a workspace
switch and SHALL never include file content.

#### Scenario: Awaiting consent is visible

- **WHEN** a valid manifest has no matching consent record
- **THEN** the entry shows `awaiting-consent` and a Review action that opens the consent dialog

#### Scenario: Active plugin shows its editors

- **WHEN** a plugin completes registration with two editor contributions
- **THEN** the entry shows `active`, its manifest name, version, publisher, exact origin and both editor labels

#### Scenario: Active plugin shows its commands

- **WHEN** a plugin completes registration with registered commands
- **THEN** the entry lists their titles and targets alongside the editor labels

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

#### Scenario: Command results are logged

- **WHEN** a command completes, fails or times out
- **THEN** the log records the command id, the outcome and the bounded message without file content

#### Scenario: Workspace switch resets the surface

- **WHEN** the user switches workspaces
- **THEN** no host status, consent action or log entry from the previous workspace remains

#### Scenario: No workspace

- **WHEN** no workspace is open
- **THEN** the section shows no host status or log and explains that a folder is required

#### Scenario: No file content is displayed

- **WHEN** any host status or log entry is rendered
- **THEN** it contains no file text, bytes, manifest response body or path outside the plugin's declared entries

## ADDED Requirements

### Requirement: Plugin commands in shell surfaces

The shell SHALL list active plugin commands in the command palette, SHALL list panel and content-view commands in the explorer context menu for the selected entry, and SHALL render `activeEditor` commands that declare `editor/title` as shell-owned actions above the matching editor. Every entry SHALL name the contributing plugin, SHALL use a shell-owned id that cannot replace a shell command, and SHALL disappear when the plugin, its registration or the workspace goes away.

#### Scenario: Palette entry

- **WHEN** a plugin registers a command for the current workspace
- **THEN** the palette lists its title under a category that names the plugin

#### Scenario: Editor action row

- **WHEN** the active document is handled by a plugin with an `activeEditor` command that declares `editor/title`
- **THEN** the document area shows a shell-owned action labelled with the command title and the plugin's name

#### Scenario: Editor action hidden for another plugin

- **WHEN** the active document is handled by a different plugin or by the shell text surface
- **THEN** no editor-title action from the other plugin is shown

#### Scenario: Explorer context menu

- **WHEN** the user opens the context menu on a file or folder
- **THEN** it lists the registered explorer commands from every active plugin, capped at ten entries, each naming its plugin

#### Scenario: Stale entry is a no-op

- **WHEN** a palette or menu entry from a removed command is invoked
- **THEN** the shell performs no delivery and reports the stale invocation only in the plugin log

#### Scenario: Failure notice

- **WHEN** a command reports failure or times out
- **THEN** the shell shows a non-blocking plain-text status notice naming the plugin and bounded to 200 characters

#### Scenario: Keyboard operation

- **WHEN** the user operates the palette, explorer menu or document action row with the keyboard
- **THEN** every plugin command is reachable, has an accessible name that includes the plugin, and Escape closes the menu without invoking it

#### Scenario: Command surfaces reset

- **WHEN** the workspace switches or the plugin is disabled
- **THEN** no palette entry, explorer entry, document action, pending invocation or failure notice from that plugin remains
