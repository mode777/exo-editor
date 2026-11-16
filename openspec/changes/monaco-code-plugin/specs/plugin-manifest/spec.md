# Spec Delta

## ADDED Requirements

### Requirement: Editor rendering surface declaration

A `contributes.fileEditors` entry SHALL accept an optional `rendering` value of
`"hidden"` or `"frame"`, SHALL default to `"hidden"` when omitted, and SHALL
reject any other value with `invalid-manifest`. `"frame"` permits the shell to
display that contribution's handler iframe in the document area; it SHALL NOT
grant storage, filesystem, event or network access or change the sandbox.

#### Scenario: Omitted rendering stays hidden

- **WHEN** a contribution omits `rendering`
- **THEN** the shell treats it as `"hidden"` and keeps its handler frame out of
  the visible document area

#### Scenario: Frame rendering is accepted

- **WHEN** a contribution declares `rendering: "frame"`
- **THEN** validation succeeds, the contribution keeps its glob and priority, and
  the shell may display its handler frame for the active document

#### Scenario: Unknown rendering is rejected

- **WHEN** a contribution declares `rendering: "overlay"` or any value other than
  `"hidden"` or `"frame"`
- **THEN** validation fails with `invalid-manifest` naming the contribution

#### Scenario: Rendering is not a capability

- **WHEN** a same-origin contribution declares `rendering: "frame"`
- **THEN** its iframe still uses `sandbox="allow-scripts"` and has no storage or
  parent DOM access

## MODIFIED Requirements

### Requirement: Consent prompt names the origin and the approved surface

The approval prompt SHALL display the plugin's name, id, version and publisher,
the exact manifest origin including scheme, host and port, the controller entry
URL, the plugin root, each declared editor entry, whether each editor renders its
own frame or stays headless, the requested permissions in plain language, the
declared globs with labels, whether the plugin can write to the workspace, and
whether it shares the shell origin.

#### Scenario: Exact origin is shown

- **WHEN** the consent prompt is rendered
- **THEN** it shows the origin as text and does not replace it with a logo, a display name or a registrable-domain label

#### Scenario: Approved root is visible

- **WHEN** the consent prompt is rendered for `https://plugins.example.com/monaco/plugin.html`
- **THEN** it shows the plugin root `https://plugins.example.com/monaco/` so the user can see which directory the approval covers

#### Scenario: Frame rendering is disclosed

- **WHEN** a contribution declares `rendering: "frame"`
- **THEN** the consent prompt states that the plugin renders its own editor
  surface inside the document area

### Requirement: Consent fingerprint

The shell SHALL persist consent machine-wide, keyed by manifest origin and plugin
id, together with a fingerprint computed over exactly the plugin id, entry
origin, plugin root path, sorted permissions, sorted editor globs and priorities,
and each editor's frame-rendering flag when it is `"frame"`. A different
fingerprint SHALL be treated as consent not granted, and a manifest field that
changes plugin behaviour SHALL be added to the fingerprint input in the same
change that introduces it. `contributes.configuration` declares user-editable
shell state, does not grant capability, and SHALL NOT change the fingerprint.

#### Scenario: Cosmetic release keeps consent

- **WHEN** a new manifest version changes only name, description, icon, homepage or version
- **THEN** the stored consent remains valid and the user is not prompted

#### Scenario: Widers re-prompt

- **WHEN** a manifest adds a permission, adds or widens a glob, changes an existing priority, moves its entry origin or moves the plugin root
- **THEN** the fingerprint changes and the plugin requires fresh consent before any frame is mounted

#### Scenario: Frame surface re-prompts

- **WHEN** an existing editor contribution changes from `rendering: "hidden"` to
  `rendering: "frame"`
- **THEN** the fingerprint changes and the plugin requires fresh consent before
  its visible frame is mounted

#### Scenario: Returning to hidden keeps consent

- **WHEN** an editor contribution changes from `rendering: "frame"` to
  `rendering: "hidden"` without any other capability change
- **THEN** the fingerprint may return to the previously approved value and the
  plugin does not gain a visible surface without approval

#### Scenario: Page added inside the root keeps consent

- **WHEN** a new release adds or renames an editor page inside the already-approved plugin root
- **THEN** the fingerprint is unchanged and the page loads without a new prompt

#### Scenario: Consent storage

- **WHEN** consent is granted
- **THEN** a record with origin, plugin id, manifest URL, version, fingerprint and grant time is written to the versioned `localStorage` key, and a corrupt store is discarded rather than repaired

#### Scenario: Revocation tears down

- **WHEN** the user revokes consent for a loaded plugin
- **THEN** its frames are disposed, its registrations are removed, and open documents handled by it fall back to the shell renderer

#### Scenario: Configuration declaration keeps consent

- **WHEN** a new manifest version adds, removes or changes its
  `contributes.configuration` declaration without changing its origin, root,
  permissions or editor globs
- **THEN** the fingerprint is unchanged and the user is not prompted again
