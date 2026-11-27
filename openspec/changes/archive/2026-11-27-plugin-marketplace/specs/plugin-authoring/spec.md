# Spec Delta

## MODIFIED Requirements

### Requirement: Self-contained plugin author guide

The repository SHALL provide an author guide covering quickstart, manifest
authoring, protocol flow, SDK usage, hosting and CORS, consent expectations,
marketplace listing authoring, examples and troubleshooting, and SHALL link
normative details to the owning contracts instead of restating values that could
drift.

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

#### Scenario: Marketplace listing page

- **WHEN** an author wants their plugin to appear in a marketplace
- **THEN** the guide explains the feed envelope, the required manifest URL, the optional display metadata, validation limits and the fact that feed metadata grants no capability and does not replace consent

#### Scenario: Marketplace listing example validates

- **WHEN** the marketplace example in the guide is validated with the marketplace schema
- **THEN** it passes without modification and links to the authoritative feed for the deployed instance

### Requirement: Release versioning and communication

The repository SHALL document independent version axes (shell SemVer, protocol
major, manifest `schemaVersion`, SDK major and marketplace feed `schemaVersion`),
a release checklist, changelog policy, deprecation timeline and the upgrade note
required for a breaking change, and SHALL keep a changelog with the current
release entry.

#### Scenario: Version axes stay independent

- **WHEN** a release document states a version
- **THEN** it names the axis (shell, protocol, manifest schema, SDK or marketplace feed schema) and the value matches its contract; changing one axis does not imply a change to the others

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

- **WHEN** the current package versions, shell version and marketplace feed schema version are read
- **THEN** the newest changelog entry names those versions, the date and any breaking change

#### Scenario: Marketplace feed schema is its own axis

- **WHEN** the marketplace feed format changes
- **THEN** the release documentation treats it as an independently versioned axis and does not infer a protocol, manifest or SDK major change
