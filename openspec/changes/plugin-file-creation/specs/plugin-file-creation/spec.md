# Spec Delta

## Purpose

Defines how a plugin offers new-file templates and asks the shell to create a new
workspace file from generated text or bytes, including the user-mediated Save As
flow, create-only guarantees, permission checks and limits.

## ADDED Requirements

### Requirement: New-file template contributions

The shell SHALL accept `contributes.newFiles` entries with `id`, `label`, `fileName`, optional `encoding` of `utf8` or `base64`, and `content`. `content` SHALL be decoded as UTF-8 or base64 and SHALL be at most 64 KiB; a plugin SHALL declare at most 20 templates and at most 128 KiB of total content. `fileName` SHALL be one path segment and SHALL NOT be a reserved name.

#### Scenario: Text template

- **WHEN** a manifest declares a `utf8` template with a component source and `fileName: "Component.tsx"`
- **THEN** validation accepts it and the decoded content is at most 64 KiB

#### Scenario: Binary template

- **WHEN** a manifest declares `encoding: "base64"` with valid base64 content
- **THEN** validation decodes it, checks the decoded byte length and accepts it when the limit is met

#### Scenario: Invalid base64

- **WHEN** a `base64` template carries characters or padding outside the base64 form
- **THEN** validation fails with `invalid-manifest` and names the contribution

#### Scenario: Template size limit

- **WHEN** one template decodes to more than 64 KiB
- **THEN** validation fails with `invalid-manifest` and no template is registered

#### Scenario: Total content limit

- **WHEN** the declared templates decode to more than 128 KiB in total
- **THEN** validation fails with `invalid-manifest` and no template is registered

#### Scenario: Template count limit

- **WHEN** a manifest declares more than 20 templates
- **THEN** validation fails with `invalid-manifest` and none is registered

#### Scenario: Invalid file name

- **WHEN** `fileName` is empty, contains `/` or `\`, is `.` or `..`, or is longer than 128 characters
- **THEN** validation fails with `invalid-manifest`

#### Scenario: Reserved file name

- **WHEN** `fileName` is `exo.json` or names a path under `.exo`
- **THEN** validation fails with `invalid-manifest` and the template is not registered

#### Scenario: Duplicate template id

- **WHEN** a manifest declares two templates with the same id
- **THEN** validation fails with `invalid-manifest`

### Requirement: Template creation flow

The shell SHALL list active templates in the explorer New File menu and the command palette, SHALL pre-fill the template's file name in the shell-owned name dialog, SHALL write the decoded content create-only after confirmation, and SHALL open the created file. A read-only workspace SHALL offer no template.

#### Scenario: Menu lists templates

- **WHEN** one or more templates are active in a writable workspace
- **THEN** the explorer New File action offers Empty File and each template grouped by plugin name

#### Scenario: Empty file remains available

- **WHEN** templates are active
- **THEN** the user can still create an empty file with the existing flow

#### Scenario: Name is pre-filled

- **WHEN** the user chooses a template
- **THEN** the name dialog opens in the current directory with the template's default file name and the content size

#### Scenario: Template is written

- **WHEN** the user confirms the name
- **THEN** the shell writes the decoded content with a create-only operation, opens the file, and shows an error without writing if the name exists

#### Scenario: Read-only workspace

- **WHEN** the workspace session is not writable
- **THEN** no template is offered and no create dialog opens

#### Scenario: Unregistered template is hidden

- **WHEN** a manifest declares a template but the controller does not register it
- **THEN** the explorer and palette do not offer it

#### Scenario: Plugin removal

- **WHEN** a plugin that owns active templates is disabled or removed
- **THEN** its templates disappear from the menu and palette immediately

### Requirement: Runtime new-file request

An active visible focused editor or view frame with `workspace:write` SHALL send a correlated `plugin/request-new-file` carrying `text` or `bytes`, an optional suggested name and an optional directory hint. The shell SHALL open one Save As dialog, SHALL write create-only after confirmation, and SHALL reply `shell/new-file-result { path, version }` or `{ cancelled: true }`.

#### Scenario: Text request

- **WHEN** a frame sends `{ text: "# Report\\n...", suggestedName: "report.md" }`
- **THEN** the shell opens the Save As dialog and writes the UTF-8 text to the chosen path

#### Scenario: Bytes request

- **WHEN** a frame sends `{ bytes: ArrayBuffer, suggestedName: "image.png" }`
- **THEN** the shell writes the exact bytes without decoding them

#### Scenario: Cancel

- **WHEN** the user cancels or closes the Save As dialog
- **THEN** the shell writes nothing and replies `{ cancelled: true }`

#### Scenario: Directory hint

- **WHEN** the request carries a directory that is missing, reserved or invalid
- **THEN** the shell silently starts at its fallback directory and the hint grants nothing

#### Scenario: Missing write permission

- **WHEN** the frame's plugin lacks `workspace:write` or the session is read-only
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Hidden or inactive frame

- **WHEN** a frame that is not visible, active or focused sends the request
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: One dialog at a time

- **WHEN** a Save As dialog is already open or the frame already has one pending
- **THEN** the shell replies `rate-limited` and opens no second dialog

#### Scenario: Size limit

- **WHEN** the text or bytes exceed 8 MiB
- **THEN** the shell replies `too-large` with a message naming the actual size and the limit, and opens no dialog

#### Scenario: Result carries the path

- **WHEN** the write succeeds
- **THEN** `shell/new-file-result` carries the workspace-absolute path and the new version

#### Scenario: No automatic open

- **WHEN** a runtime-generated file is written
- **THEN** the shell does not create a tab for it unless the frame asks to open it

### Requirement: Create-only and reserved paths

The shell SHALL create a new file only when the target does not exist, SHALL reject reserved names and paths, SHALL reject a directory target, and SHALL NOT truncate or overwrite an existing file. A collision SHALL surface as `already-exists` and SHALL keep the dialog open.

#### Scenario: Existing file

- **WHEN** the chosen name already exists
- **THEN** the shell writes nothing, reports `already-exists` in the dialog and keeps it open for another name

#### Scenario: Reserved path

- **WHEN** the chosen name is `exo.json` or resolves under `.exo/`
- **THEN** the shell rejects it with `permission-denied` and writes nothing

#### Scenario: Directory target

- **WHEN** the chosen path is an existing directory
- **THEN** the shell reports `not-a-file` and writes nothing

#### Scenario: Atomic race after confirmation

- **WHEN** the provider supports atomic create, another writer creates the file between confirmation and the write, and the shell uses its conditional create
- **THEN** the create-only write fails with `already-exists`, no bytes are written and the dialog reports the collision

#### Scenario: No partial file

- **WHEN** a create fails for any reason
- **THEN** no empty or partial file is left behind

### Requirement: Binary and text handling

Text SHALL be written as UTF-8 and binary SHALL be written as the exact bytes. The shell SHALL NOT decode, transform or execute template or generated content, and SHALL show the size and, for text templates, a bounded preview before writing.

#### Scenario: Exact bytes

- **WHEN** a template or request supplies binary bytes
- **THEN** the provider receives the same bytes and no text encoding is applied

#### Scenario: Text encoding

- **WHEN** a template or request supplies text
- **THEN** the provider receives its UTF-8 encoding

#### Scenario: No execution

- **WHEN** a template contains script, template syntax or HTML
- **THEN** the shell writes it literally and never evaluates it

#### Scenario: Text preview

- **WHEN** the user chooses a text template
- **THEN** the dialog shows a bounded preview and the decoded size

#### Scenario: Binary preview

- **WHEN** the user chooses a binary template or a runtime bytes request
- **THEN** the dialog shows the byte size and a binary label instead of decoding it

### Requirement: New-file permissions and consent

A template or runtime request SHALL require `workspace:write` and a writable session. The first-grant prompt SHALL list the template labels and default names and state that the plugin can create files the user chooses. New-file declarations SHALL NOT change the consent fingerprint.

#### Scenario: Template without write

- **WHEN** a manifest declares `newFiles` but not `workspace:write`
- **THEN** the manifest may validate but every template registration is rejected with `permission-denied` and no template is offered

#### Scenario: First grant lists templates

- **WHEN** a manifest with templates is shown for consent
- **THEN** the prompt lists each label and default file name and states that the plugin writes only files the user confirms

#### Scenario: Added template keeps consent

- **WHEN** an already-approved plugin adds a template
- **THEN** the fingerprint is unchanged, no consent dialog opens and the template appears after the next registration

#### Scenario: Plugin name in the dialog

- **WHEN** a template or runtime Save As dialog is shown
- **THEN** it names the plugin and does not accept plugin-supplied dialog text beyond the suggested name

### Requirement: New-file lifecycle and errors

The shell SHALL close a pending Save As dialog without writing on plugin removal, workspace switch or frame disposal, SHALL drop late results, and SHALL log ids and error codes without content. A failed write SHALL leave no partial file.

#### Scenario: Plugin removal while the dialog is open

- **WHEN** the owning plugin is disabled or removed with a Save As dialog pending
- **THEN** the dialog closes, nothing is written and the pending request settles with `closed` or no reply

#### Scenario: Workspace switch

- **WHEN** the workspace switches with a Save As dialog pending
- **THEN** the dialog closes before the old session is released and no write reaches either workspace

#### Scenario: Frame disposal

- **WHEN** the frame is disposed with a request pending
- **THEN** the dialog closes, no write occurs and a late user action is ignored

#### Scenario: Late result

- **WHEN** a create resolves after the dialog was cancelled or the frame was disposed
- **THEN** the shell drops the result and creates no tab

#### Scenario: Log has no content

- **WHEN** a create attempt is logged
- **THEN** the entry carries the plugin id, template id or request id, the target path and the error code, never the content

#### Scenario: Write failure

- **WHEN** the provider rejects the write
- **THEN** the shell reports the stable error code in the dialog, writes no partial file and leaves the dialog usable
