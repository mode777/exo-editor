# reference-code-plugin Specification

## Purpose
Proves the plugin architecture with a Monaco-based reference code editor that is
built only on the SDK, deployed beside the shell and treated like any other
untrusted plugin.

## Requirements

### Requirement: SDK-only reference plugin

The reference code editor SHALL be a plugin package built only on
`@exo/plugin-sdk` for its protocol work, SHALL declare its manifest and editor
pages like any third-party plugin, and SHALL NOT import shell source, receive a
shell DOM node, a workspace handle, a token or any other privileged object.

#### Scenario: No hand-written protocol

- **WHEN** the reference plugin source is scanned
- **THEN** it contains no hand-written envelope, handshake, request-correlation or
  registration message construction outside the SDK

#### Scenario: No shell import

- **WHEN** the reference plugin is built
- **THEN** its import graph contains no shell module, no workspace provider and no
  server credential

#### Scenario: Same consent and sandbox rules

- **WHEN** the reference plugin is added to a workspace
- **THEN** it goes through the same manifest validation, consent prompt, origin
  checks and sandbox selection as every other plugin

### Requirement: Monaco code editing surface

The reference plugin SHALL register declared editor globs for TypeScript,
JavaScript, JSON and Markdown files, SHALL load Monaco inside its own iframe,
SHALL select the language from the file's extension, and SHALL NOT use a
language server, remote completion service or network request for editing.

#### Scenario: Supported file opens in Monaco

- **WHEN** the user opens a `.ts`, `.json` or `.md` file with the reference plugin
  enabled
- **THEN** the document area shows the plugin's Monaco editor and the file's
  language is selected from its extension

#### Scenario: No language server

- **WHEN** the plugin is opened with no network connection beyond the site assets
- **THEN** syntax highlighting and text editing still work and no language server
  request is made

#### Scenario: Unsupported extension falls through

- **WHEN** a file's path does not match any contribution
- **THEN** the shell uses its normal editor selection and the reference plugin is
  not mounted

### Requirement: Editing, saving and external changes

The reference plugin SHALL report dirty state when the model changes, SHALL answer
the shell's save request with the current model text, SHALL clear its dirty state
only after a successful save when no later edit occurred, and SHALL react to an
external change without silently overwriting the newer content.

#### Scenario: Edit marks the tab dirty

- **WHEN** the user changes the Monaco model
- **THEN** the plugin reports `plugin/dirty` with `true` and the shell tab shows
  the unsaved indicator

#### Scenario: Save round-trips exact text

- **WHEN** the shell requests a save
- **THEN** the plugin returns the exact current model text and the shell writes it
  with the version it last delivered

#### Scenario: Failed save stays dirty

- **WHEN** the shell reports a conflict, timeout or permission failure
- **THEN** the plugin keeps the edit and remains dirty instead of claiming success

#### Scenario: External change is visible

- **WHEN** the open file changes on disk
- **THEN** the plugin shows the external-change state and does not replace a dirty
  model without an explicit reload

#### Scenario: Deleted file is not recreated

- **WHEN** the open file is deleted and the shell requests a save
- **THEN** the plugin returns the buffer but the shell's write fails with
  `not-found` and no file is recreated

### Requirement: Theme and file-size guard

The reference plugin SHALL apply the shell's initial theme to Monaco, SHALL update
it from `theme/changed`, and SHALL refuse to load a file above its documented
in-frame limit instead of blocking the shell or losing content.

#### Scenario: Theme changes live

- **WHEN** the user changes the shell theme while a file is open
- **THEN** the Monaco theme changes without reopening the document

#### Scenario: Oversized file is refused safely

- **WHEN** a matching file exceeds the plugin's documented Monaco size limit
- **THEN** the plugin shows a clear message in its surface, does not create a
  Monaco model, reports clean state and does not read the file

#### Scenario: Shell stays responsive

- **WHEN** the plugin refuses an oversized file or a read fails
- **THEN** the tab, the shell chrome and other documents remain usable

### Requirement: Default same-origin deployment

The reference plugin SHALL be built to a static child path of the shell's GitHub
Pages site, SHALL be copied into the deployed artifact after the shell budget and
content checks, and SHALL work with the stricter `allow-scripts` sandbox that a
same-origin first-party plugin receives.

#### Scenario: Child path is deployed

- **WHEN** the site is built and deployed
- **THEN** the reference manifest is available at the documented child-path URL
  and points only at pages inside that path

#### Scenario: Same-origin plugin has no storage

- **WHEN** the deployed same-origin reference plugin runs
- **THEN** its iframe uses `sandbox="allow-scripts"` and its attempts to use
  `localStorage` or IndexedDB fail without breaking editing

#### Scenario: Cross-origin build is possible

- **WHEN** the same build is served from a different origin
- **THEN** the shell frames it with `sandbox="allow-scripts allow-same-origin"`,
  it keeps its own storage and editing still round-trips

### Requirement: Shell contains no Monaco

The shell SHALL NOT depend on Monaco, SHALL NOT import or bundle the reference
plugin, and SHALL expose no reference-editor-specific command, path or privilege.

#### Scenario: Bundle guard passes

- **WHEN** the shell production bundle is inspected
- **THEN** it contains no Monaco editor code and a CI check fails if a Monaco
  marker appears

#### Scenario: Disabling falls back

- **WHEN** the reference plugin is disabled or removed in settings
- **THEN** matching files open in the shell's text renderer and no plugin frame
  remains

#### Scenario: Example workspace is usable

- **WHEN** the documented example workspace is opened with the deployed manifest
- **THEN** the manifest URL is absolute and the workspace contains files that
  exercise TypeScript, JSON and Markdown editing
