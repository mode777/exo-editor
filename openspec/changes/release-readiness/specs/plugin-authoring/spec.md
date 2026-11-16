# Spec Delta

## Purpose

Defines the author-facing handoff package: the guide, demo workspace, deployed
walkthrough record and release communication that let a plugin author build and
maintain a plugin without reading shell source.

## ADDED Requirements

### Requirement: Self-contained plugin author guide

The repository SHALL provide an author guide covering quickstart, manifest
authoring, protocol flow, SDK usage, hosting and CORS, consent expectations,
examples and troubleshooting, and SHALL link normative details to the owning
contracts instead of restating values that could drift.

#### Scenario: Guide-only build

- **WHEN** an author follows only the guide and the starter template with no
  access to shell source
- **THEN** the author can build, host and register a minimal file editor using
  the documented commands, manifest fields and SDK calls

#### Scenario: Manifest examples validate

- **WHEN** a manifest example in the guide is validated with the shared schema
  and the manifest contract rules
- **THEN** it passes without modification

#### Scenario: Commands and paths exist

- **WHEN** the guide names a repository path, script or deployed URL
- **THEN** the path or URL exists, or the guide labels it explicitly as
  illustrative rather than runnable

#### Scenario: No duplicated normative values

- **WHEN** the guide mentions a protocol limit, error code, message name or
  manifest field
- **THEN** it links to the contract that owns it and introduces no conflicting
  value or alternative name

#### Scenario: Hosting checklist is complete

- **WHEN** an author follows the hosting checklist
- **THEN** it covers HTTPS, CORS response headers, localhost development,
  same-origin child-path hosting and cross-origin hosting, and states the
  sandbox consequence of each

### Requirement: Demo workspace exercises shipped editors

The repository SHALL provide a demo workspace whose `exo.json` declares the
deployed reference code plugin and template plugin and whose files select the
code plugin, the template plugin and the shell text surface, with a README that
names the expected observations.

#### Scenario: Opens from the deployed shell

- **WHEN** the demo folder is opened in the deployed shell
- **THEN** both declared plugins request consent and their files open in the
  expected surface without a local build or dev server

#### Scenario: Editor coverage

- **WHEN** the demo's TypeScript, JSON and Markdown files are opened
- **THEN** the reference code plugin handles them; a `*.template.txt` file uses
  the template plugin, and a plain text file uses the shell text surface

#### Scenario: Denied consent falls back

- **WHEN** the user denies consent for either demo plugin
- **THEN** the workspace still opens and matching files fall back to the shell
  text surface or the no-editor state with no plugin frame

#### Scenario: Workspace switch resets the demo

- **WHEN** the user switches away from the demo workspace and back
- **THEN** no tab, plugin frame, handler or log entry from the previous visit
  remains

### Requirement: Walkthrough is recorded from the deployed shell

The repository SHALL provide a numbered walkthrough with expected observations
and committed screenshots captured from the deployed URL, tied to the deployed
commit, covering workspace open, consent, both plugin editor paths, shell text,
save and dirty handling, theme, settings fallback and the unsupported folder
state.

#### Scenario: Steps reproduce

- **WHEN** each walkthrough step is followed on the deployed URL with the demo
  workspace
- **THEN** the recorded observation matches the shell's behaviour

#### Scenario: Screenshot provenance

- **WHEN** a committed walkthrough screenshot is inspected
- **THEN** the walkthrough records the capture date, deployed commit and URL it
  came from

#### Scenario: Deployed evidence only

- **WHEN** the walkthrough references a build or server
- **THEN** it is the deployed URL, never a local dev server or local build

#### Scenario: Required coverage

- **WHEN** the walkthrough is read end to end
- **THEN** it covers every path named in this requirement, including the
  explicit unsupported state in a browser without a directory picker

### Requirement: Release versioning and communication

The repository SHALL document independent version axes (shell SemVer, protocol
major, manifest `schemaVersion`, SDK major), a release checklist, changelog
policy, deprecation timeline and the upgrade note required for a breaking
change, and SHALL keep a changelog with the current release entry.

#### Scenario: Version axes stay independent

- **WHEN** a release document states a version
- **THEN** it names the axis (shell, protocol, manifest schema or SDK) and the
  value matches its contract; changing one axis does not imply a change to the
  others

#### Scenario: Release checklist is complete

- **WHEN** a release is prepared
- **THEN** the checklist includes the local verify gate, deployed verification,
  security, accessibility and performance evidence, documentation updates and
  the OpenSpec archive state

#### Scenario: Breaking change requires a major and an upgrade note

- **WHEN** a wire field is removed or reinterpreted
- **THEN** the plan requires a new protocol major, a new SDK major and a written
  upgrade note before release, and the old major is not silently accepted

#### Scenario: Deprecation is announced

- **WHEN** an SDK API is deprecated
- **THEN** the plan names the announcement channel and requires the deprecated
  API to remain functional for the rest of the current major

#### Scenario: Changelog matches the release

- **WHEN** the current package versions and shell version are read
- **THEN** the newest changelog entry names those versions, the date and any
  breaking change
