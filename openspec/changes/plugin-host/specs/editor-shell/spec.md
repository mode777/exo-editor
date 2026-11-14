# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Shell content security policy

The deployed shell SHALL apply a CSP to its document with
`frame-src https: http://localhost:*`,
`connect-src 'self' https: http://localhost:*` and `script-src 'self'`, and no
`unsafe-eval` or `unsafe-inline` script sources, so plugin code cannot execute in
the shell's realm and no privileged evaluation path exists. The localhost sources
exist only because the manifest contract permits `http://localhost`; no other
plain-HTTP origin is allowed. Static hosting cannot set response headers, so the
policy SHALL be embedded in the shell's HTML document and SHALL be present in the
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
