# Spec Delta

## ADDED Requirements

### Requirement: New-file template contribution shape

A `contributes.newFiles` entry SHALL have `id`, `label`, `fileName`, optional `encoding` of `utf8` or `base64`, and `content`. The id SHALL match `^[a-z0-9][a-z0-9.-]{0,63}$` and be unique among templates, the label SHALL be 1-40 characters, `fileName` SHALL be one path segment of 1-128 characters and SHALL NOT be a reserved name, `content` SHALL be at most 64 KiB after decoding, and a manifest SHALL declare at most 20 templates and at most 128 KiB of total decoded content.

#### Scenario: Valid text template

- **WHEN** a manifest declares `{ "id": "ts-component", "label": "TypeScript component", "fileName": "Component.tsx", "content": "..." }`
- **THEN** validation accepts it and exposes it to the host

#### Scenario: Valid binary template

- **WHEN** a manifest declares `encoding: "base64"` with valid base64 content within the limits
- **THEN** validation decodes it without writing and accepts it

#### Scenario: Unknown encoding

- **WHEN** a template declares an encoding other than `utf8` or `base64`
- **THEN** validation fails with `invalid-manifest` and names the field

#### Scenario: Invalid base64

- **WHEN** a `base64` template does not decode
- **THEN** validation fails with `invalid-manifest` and no template is registered

#### Scenario: Decoded size limit

- **WHEN** one template decodes to more than 64 KiB
- **THEN** validation fails with `invalid-manifest` and no template is registered

#### Scenario: Total size limit

- **WHEN** the templates decode to more than 128 KiB in total
- **THEN** validation fails with `invalid-manifest` and no template is registered

#### Scenario: Template count limit

- **WHEN** a manifest declares more than 20 templates
- **THEN** validation fails with `invalid-manifest` and none is registered

#### Scenario: Invalid file name

- **WHEN** `fileName` is empty, contains `/` or `\`, is `.` or `..`, or is longer than 128 characters
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Reserved file name

- **WHEN** `fileName` is `exo.json` or resolves under `.exo`
- **THEN** validation fails with `invalid-manifest` and the template is not registered

#### Scenario: Duplicate template id

- **WHEN** a manifest declares two templates with the same id
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Empty template array

- **WHEN** a manifest declares `newFiles: []`
- **THEN** validation accepts it and the plugin contributes no template

### Requirement: New-file template consent display

The shell SHALL list each declared new-file template by label and default file name in the first-grant consent prompt, SHALL state that the plugin writes only a file the user confirms, and SHALL NOT include the template declaration or its content in the consent fingerprint.

#### Scenario: First grant lists templates

- **WHEN** a manifest with templates is shown for consent
- **THEN** the prompt lists each label and default name under the plugin's approved surface

#### Scenario: Added template keeps consent

- **WHEN** an already-approved plugin adds, removes or changes a new-file template
- **THEN** the fingerprint is unchanged, the stored consent remains valid and no dialog is reopened

#### Scenario: Content change keeps consent

- **WHEN** a template's content bytes change without changing its id or default name
- **THEN** the fingerprint is unchanged and the user sees the new content only after choosing the template

#### Scenario: Permission is still required

- **WHEN** a manifest declares templates without `workspace:write`
- **THEN** the consent prompt still requests no write permission and every template registration is rejected with `permission-denied`

#### Scenario: Engine gate for older shells

- **WHEN** a manifest uses `contributes.newFiles` and its `engines.exo` range excludes a shell that does not support the contribution
- **THEN** that shell reports `incompatible-engine` before accepting the manifest
