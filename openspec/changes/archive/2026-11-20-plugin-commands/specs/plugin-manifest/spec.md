# Spec Delta

## MODIFIED Requirements

### Requirement: Consent prompt names the origin and the approved surface

The approval prompt SHALL display the plugin's name, id, version and publisher, the exact manifest origin including scheme, host and port, the controller entry URL, the plugin root, each declared editor entry, whether each editor renders its own frame or stays headless, each declared panel with its title and left or right location, each declared content view, each declared command with its title, target and menu placements, the requested permissions in plain language, the declared globs with labels, whether the plugin can write to the workspace, whether its panels can open files or views, and whether it shares the shell origin.

#### Scenario: Exact origin is shown

- **WHEN** the consent prompt is rendered
- **THEN** it shows the origin as text and does not replace it with a logo, a display name or a registrable-domain label

#### Scenario: Approved root is visible

- **WHEN** the consent prompt is rendered for `https://plugins.example.com/monaco/plugin.html`
- **THEN** it shows the plugin root `https://plugins.example.com/monaco/` so the user can see which directory the approval covers

#### Scenario: Frame rendering is disclosed

- **WHEN** a contribution declares `rendering: "frame"`
- **THEN** the consent prompt states that the plugin renders its own editor surface inside the document area

#### Scenario: Panels are disclosed

- **WHEN** a manifest declares a primary and a secondary panel
- **THEN** the prompt lists their titles, their locations and that a primary panel adds an activity-bar item

#### Scenario: Content views are disclosed

- **WHEN** a manifest declares a content view
- **THEN** the prompt lists its title and that it opens as a read-only tab

#### Scenario: Commands are disclosed

- **WHEN** a manifest declares commands
- **THEN** the prompt lists each command's title, whether it acts on the active editor, a panel or a content view, and where it can appear

#### Scenario: Navigation intents are disclosed

- **WHEN** a plugin declares a panel or content view and `workspace:read`
- **THEN** the prompt states that the plugin can open workspace files and views, and a plugin without read is described as unable to open files

### Requirement: Consent fingerprint

The shell SHALL persist consent machine-wide, keyed by manifest origin and plugin id, together with a fingerprint computed over exactly the plugin id, entry origin, plugin root path, sorted permissions, sorted editor globs and priorities, and each editor's frame-rendering flag when it is `"frame"`. A different fingerprint SHALL be treated as consent not granted, and a manifest field that changes autonomous data access or an existing approved surface SHALL be added to the fingerprint input in the same change that introduces it. `contributes.configuration`, `contributes.panels`, `contributes.contentViews` and `contributes.commands` declare user-invoked shell state or surfaces, do not grant autonomous access, and SHALL NOT change the fingerprint.

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

- **WHEN** a new manifest version adds, removes or changes its `contributes.configuration` declaration without changing its origin, root, permissions or editor globs
- **THEN** the fingerprint is unchanged and the user is not prompted again

#### Scenario: Adding a panel or content view keeps consent

- **WHEN** a new manifest version adds, removes or changes a `contributes.panels` or `contributes.contentViews` declaration without changing its origin, root, permissions or editor globs
- **THEN** the fingerprint is unchanged, the stored consent remains valid and the new surface appears after the plugin's next registration

#### Scenario: Adding a command keeps consent

- **WHEN** a new manifest version adds, removes or changes a `contributes.commands` declaration without changing its origin, root, permissions or editor globs
- **THEN** the fingerprint is unchanged, the stored consent remains valid and the command appears only after the plugin's next registration

#### Scenario: View surfaces stay inside the approved root

- **WHEN** a new panel or content-view page is added inside the already-approved plugin root
- **THEN** it loads without a new prompt because the prompt approved the directory tree

## ADDED Requirements

### Requirement: Command contribution shape

A `contributes.commands` entry SHALL have `id`, `title`, optional `category`, a `target` and optional `menus`. The id SHALL match `^[a-z0-9][a-z0-9.-]{0,63}$` and be unique among commands, the title SHALL be 1-40 characters, and the category SHALL be 1-40 characters when present.

#### Scenario: Valid editor command

- **WHEN** a manifest declares `{ "id": "format", "title": "Format Document", "target": "activeEditor" }`
- **THEN** validation accepts it and the command is available for registration

#### Scenario: Duplicate command id

- **WHEN** two commands declare the same id
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Invalid title or category

- **WHEN** a command title or category is empty or longer than 40 characters
- **THEN** validation fails with `invalid-manifest`

### Requirement: Command target declaration

A command target SHALL be the string `activeEditor`, `{ "kind": "panel", "id": "<panel id>" }` or `{ "kind": "contentView", "id": "<content-view id>" }`. A panel or content-view id SHALL name a contribution declared in the same manifest.

#### Scenario: Valid panel command

- **WHEN** a manifest declares a panel `reports` and a command targeting `{ "kind": "panel", "id": "reports" }`
- **THEN** validation accepts the command

#### Scenario: Valid content-view command

- **WHEN** a manifest declares a content view `report` and a command targeting it
- **THEN** validation accepts the command

#### Scenario: Target is not declared

- **WHEN** a command targets a panel or content view the manifest does not declare
- **THEN** validation fails with `invalid-manifest` and names the command and target field

#### Scenario: Unknown target kind

- **WHEN** a target is a string other than `activeEditor` or an object with an unknown kind
- **THEN** validation fails with `invalid-manifest`

### Requirement: Command menu and limit validation

The optional `menus` array SHALL contain unique values from `commandPalette`, `explorer/context` and `editor/title`, SHALL default to `["commandPalette"]`, and SHALL be validated against the target. `editor/title` SHALL require an `activeEditor` target and `explorer/context` SHALL require a panel or content-view target. A manifest SHALL declare at most 32 commands.

#### Scenario: Default placement

- **WHEN** a command omits `menus`
- **THEN** validation accepts it and the shell offers it only in the command palette

#### Scenario: Invalid menu for the target

- **WHEN** an `activeEditor` command lists `explorer/context`
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Duplicate menu entry

- **WHEN** a command lists `editor/title` twice
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Command limit

- **WHEN** a manifest declares 33 commands
- **THEN** validation fails and reports the limit instead of truncating silently

#### Scenario: Empty contribution

- **WHEN** a manifest declares `commands: []`
- **THEN** validation accepts it and the plugin has no commands

### Requirement: Command consent display

The first-grant consent prompt SHALL list every declared command and its target, SHALL identify the contributing plugin on every command surface, and SHALL NOT require a new approval when an already-approved plugin adds, removes or changes a command.

#### Scenario: First grant lists commands

- **WHEN** a manifest with commands is shown for the first time
- **THEN** the prompt lists each command title and whether it targets the active editor, a panel or a content view

#### Scenario: Adding a command does not reprompt

- **WHEN** an approved plugin publishes a new manifest that adds a command without changing its origin, root, permissions or editor globs
- **THEN** no consent dialog reopens and the command appears after the next registration

#### Scenario: Command surfaces name the plugin

- **WHEN** a command appears in the palette, the explorer context menu or the document action row
- **THEN** the surface includes the plugin's name so the command cannot be mistaken for a shell command
