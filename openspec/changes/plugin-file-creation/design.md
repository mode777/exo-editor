# Design

## Context

See `proposal.md` for motivation. The current create path is local to the
explorer: `ExplorerView` opens a name dialog and calls
`session.write(path, new Uint8Array(), { create: true })`. `WriteOptions` has
`create`, `ifVersion` and `signal`; both the memory and folder providers treat
`create: true` as "create the parent and open or replace the target", so a name
that already exists is silently overwritten. The plugin protocol has no create
message; a plugin can only write a document it has open through the save round
trip.

The shell already has the pieces this change needs: the plugin-scoped workspace
facade, the `useModalDialog` focus-trap pattern (file picker, consent, remote
connect), a directory-listing path for the picker, and a host registration
registry. The Stratofold adapter maps `ifVersion` to a conditional upload and
documents `"*"` as the create-only condition; the memory provider is synchronous;
the folder provider has no atomic create primitive.

## Goals / Non-Goals

**Goals:**

- Give plugins and users one shell-owned path that creates a new file with
  explicit content, without overwriting.
- Keep the template and runtime flows on the same write, dialog and error path.
- Support text and binary content with explicit, testable caps.
- Reuse the existing modal, workspace, permission and host-registration patterns.

**Non-Goals:**

- Editing an existing file through the create path.
- Atomic create on a backend that cannot provide it.
- Chunked uploads above 8 MiB.
- Placeholder expansion or template execution.
- A native browser save picker or an arbitrary URL destination.
- Auto-opening a runtime-generated file.

## Decisions

### D1 - One create path

`NewFileController` owns the single pending create request, the target directory,
the name, the content bytes and the provider call. Both the manifest template
flow and `plugin/request-new-file` go through it. The explorer menu and the
palette only choose the initial name/content; they do not write directly. This
keeps reserved-name checks, existence checks, size limits, errors, logging and
cancellation in one place.

Alternatives: extend the explorer's local dialog twice (two copies of the write
and validation path) or let plugins write through the save flow with a synthetic
document (mixes two different ownership models).

### D2 - `createOnly` is a write option, atomic where the backend allows

Add `createOnly?: boolean` to `WriteOptions`. A create-only write first rejects
an existing target with `already-exists`, then writes. The memory provider checks
and writes synchronously, so its create is atomic. The folder provider checks
with `getFileHandle`/`getFile`, then writes with `createWritable`; the File
System Access API has no atomic create. The Stratofold provider also pre-checks:
`@stratofold/client` 0.12.0's only conditional upload is `If-Match`, where
`"*"` requires the target to **exist** and is therefore the update-only
condition, not create-only. The client exposes no target-absent conditional.

The shell does not claim an atomic guarantee for the folder or Stratofold
providers. Both provider notes record the residual check-to-write race, and the
dialog serializes the shell's own creates, so the race requires a second writer.
This is the honest trade-off: disabling new-file creation on folder workspaces
(the primary case) or pretending the check is atomic would both be worse.

Alternatives: `overwrite: false` (changes the default semantics of every write),
a temporary file plus rename (FSA move is not available in the supported
matrix), a shell-level stat-only check (same race and loses the memory
provider's atomic guarantee), or inventing an `If-None-Match` upload the
published client and server do not document.

### D3 - Templates are validated manifest data

`contributes.newFiles` is fixed data: `id`, `label`, `fileName`, `encoding`
(`utf8` or `base64`) and `content`. Validation decodes base64, checks 64 KiB per
template, 20 templates and 128 KiB total decoded content, and rejects a filename
that is not one segment or is reserved. The decoded bytes are held in the plugin
manifest, not re-read from the network at create time.

Alternatives: let the plugin generate the template at create time through a
frame (it already can, through `request-new-file`), or allow arbitrary file
content in the manifest without a cap (the 256 KiB manifest cap and message
limits would make errors late).

### D4 - Runtime creation is a user-mediated Save As

`plugin/request-new-file` carries `text` or `bytes`, an optional
`suggestedName` and an optional `directory` hint. The shell opens one dialog with
the plugin name, a start directory, an editable name, the content size and a
bounded text preview. The final path is chosen by the user. The request is
capped at 8 MiB, serialized with one dialog per shell, and limited to ten
requests per rolling second per frame.

The shell does not auto-open the created file: a generated image has no useful
text surface, and the frame can call `open-file` if that is appropriate. A
manifest template does open its file because the user invoked "New File".

Alternatives: a path supplied by the plugin (arbitrary write), auto-open every
result (bad for binary), or a native save picker (no workspace path and no
reserved-path control).

### D5 - Permission, focus and lifecycle gates

Creation requires `workspace:write` and a writable session. A runtime request is
accepted only from an active, visible and focused view or editor frame, using the
same gate as the file picker. A template is user-initiated from shell chrome and
needs no frame. A pending dialog is closed without a write on plugin removal,
workspace switch or frame disposal; a late result is dropped.

### D6 - No fingerprint change; the dialog names the plugin

New-file templates are user-invoked and write only a file the user confirms, so
they are excluded from the consent fingerprint. The first-grant prompt lists the
labels and default names and the write description. An already-approved plugin
may add or change a template without a re-prompt. The dialog names the plugin and
uses the plugin's suggested name only as a validated hint, never as dialog text.

### D7 - The explorer menu and palette share the controller

The explorer's New File action opens a shell menu when templates are active:
Empty File plus each template grouped by plugin name. A palette entry per
template uses the plugin name as its category. Both call
`NewFileController.begin({ template })` with the selected directory; the
controller opens the shared dialog, validates the name, writes create-only and
opens the file.

Alternatives: one dialog listing templates and a name field (loses the direct
"New File" action), or template-specific commands that write without a dialog
(the user would not see the path).

### D8 - SDK surface

`RegistrationClient` gains `registerNewFile(id)`. `EditorClient` and `ViewClient`
gain `requestNewFile({ text | bytes, suggestedName?, directory? })`, which
preflights the support bit, `workspace:write` and the 8 MiB size, sends one
correlated message and resolves `{ path, version }` or `null` on cancellation.
`shell/init` gains `capabilities.createFile`; registration init gains
`capabilities.newFiles`. SDK `1.7.0`, protocol major `1`.

### D9 - Binary and text are never interpreted

Templates are decoded only to bytes; runtime text is UTF-8 encoded and runtime
bytes are passed through. The shell never evaluates template syntax, script or
HTML. The dialog shows a bounded preview for text and a size/binary label for
bytes. The created file is opened through the normal document path, so a binary
image without a matching plugin editor shows the shell's no-editor state rather
than being written by the text surface.

## Risks / Trade-offs

- **Folder create is not atomic** -> pre-check plus provider write; the residual
  external race is documented in the provider note. The memory path is atomic.
- **Stratofold create is not atomic** -> the published client has no
  target-absent conditional, so the adapter pre-checks and documents the race.
  It never replaces an existing target it observed.
- **Large payloads** -> 8 MiB cap, local preflight, one message, no chunking.
  Above that the plugin must split or use a future chunked API.
- **Binary templates inflate the manifest** -> 64 KiB per template, 128 KiB total
  and base64 validation. The 256 KiB manifest cap remains the outer bound.
- **Remote provider conditional create** -> the adapter uses a pre-check and
  reports `already-exists`; the provider note records why `If-Match: "*"` cannot
  express create-only.
- **Overwrite regression in the existing explorer flow** -> the existing Empty
  File path is moved to `createOnly` and the conformance suite covers an existing
  target.
- **Dialog spam** -> one shell dialog, ten requests per second, active/visible/
  focused gate.
- **Content in logs** -> log plugin id, request/template id, target path and code
  only. Never log text or bytes.
- **Template changes without re-prompt** -> deliberate; the user sees the content
  in the dialog preview and the created file is editable and undoable.

## Migration Plan

1. Land `plugin-local-events` and `plugin-view-surfaces` first. This change adds
   shell `0.5.0`, SDK `1.7.0`, protocol `1` and keeps manifest schema `1`.
2. Add `createOnly` to `WriteOptions` with a default of `false`; existing writes
   are unchanged. Implement it in the memory, folder and Stratofold providers and
   add conformance cases. The memory provider is atomic; the folder and
   Stratofold providers pre-check and document the residual race.
3. Move the explorer's existing Empty File write to `createOnly`; this fixes the
   current silent-overwrite behavior without changing the user flow.
4. Old shells omit `capabilities.createFile`/`newFiles`; the SDK rejects locally
   and the plugin keeps its existing behavior. A manifest with `newFiles` sets an
   `engines.exo` range that includes `0.5.0`.
5. Rollback is a redeploy; no persisted state or schema migration is involved.
