# Proposal

## Why

A plugin can write only a file it already has open, and only through the shell's save round trip. It cannot create a new workspace file. Generators that produce an image, a report or a scaffold have nowhere to put the result, and a workspace cannot offer a "New File" template with a default name and content. The shell already owns the create path, the workspace facade and the modal patterns, so the safe version is a user-mediated Save As plus fixed manifest templates.

## What Changes

- Add `contributes.newFiles` entries with `id`, `label`, `fileName`, optional `encoding` (`utf8` or `base64`) and `content`. A template is fixed manifest data, limited to 64 KiB of decoded content each, 20 templates per plugin and 128 KiB total content per plugin.
- Extend `plugin/register` with `newFiles` ids and the registration ack additively. A declared but unregistered template is not offered.
- Add a correlated `plugin/request-new-file { suggestedName?, directory?, text | bytes }` for editor and view frames. The shell opens a Save As dialog (plugin name, directory, editable name, size), writes the result create-only, and replies `shell/new-file-result { path, version }` or `{ cancelled: true }`.
- Add a create-only write option to the workspace contract (`WriteOptions.createOnly`). A collision observed at the provider check is `already-exists`; the memory and Stratofold providers use an atomic conditional create, and the local folder provider documents its residual check-to-write race because the File System Access API has no atomic create.
- Add the runtime limit: one generated file at a time, up to 8 MiB of text or bytes, with a `too-large` message naming the actual size and the limit.
- Show the manifest templates in the explorer's New File menu and as command-palette entries, pre-filling the name and writing the template bytes on confirmation. The runtime request opens the same dialog with plugin-supplied bytes.
- Require `workspace:write`, a writable workspace, an active visible focused frame and a free dialog slot. A second concurrent request is `rate-limited`.
- Do not change the consent fingerprint. The first-grant prompt lists the templates and the write description; the plugin name appears in the dialog. A template content change does not re-prompt.
- Add SDK `requestNewFile()`, `registerNewFile()`, the template and result types, and SDK `1.7.0`; shell `0.5.0`.
- Do not auto-open a runtime-generated file; the result carries its path and the frame can call `open-file` if it wants. A manifest template does open the created file, because the user chose "New File".

**Not breaking:** the messages and manifest fields are additive within protocol major `1`, the schema stays `1`, and older shells report `incompatible-engine` for a manifest with a suitable `engines.exo`. A plugin without `workspace:write` cannot create files.

**Explicit non-goals:** overwriting an existing file, arbitrary destination paths without a dialog, chunked uploads above 8 MiB, templating placeholders or expression evaluation, binary content in the shell text editor, and automatic file creation without a user action.

## Capabilities

### New Capabilities

- `plugin-file-creation`: manifest new-file templates, the user-mediated runtime Save As, the shared create path, limits, permission and consent behavior.

### Modified Capabilities

- `workspace-access`: adds `createOnly` to the provider write contract and the `already-exists` collision rule for every provider.
- `plugin-manifest`: adds the `contributes.newFiles` shape, limits and consent display.
- `plugin-protocol`: adds `plugin/request-new-file`, `shell/new-file-result`, the phase rules, size limits and errors.
- `plugin-sdk`: adds `requestNewFile()`, `registerNewFile()`, template/result types and the support bit.
- `editor-shell`: adds the explorer New File template menu, the palette entries and the Save As dialog.
- `plugin-host`: registers and exposes new-file templates and removes them with the plugin.

## Impact

- `schema/exo.schema.json`, `apps/shell/src/plugins/manifest.ts`, `registration.ts`, `registry.ts`, `host.ts`.
- `apps/shell/src/workspace/contract.ts`, `session.ts`, the memory, folder and Stratofold providers, and the conformance suite for `createOnly`.
- New file-creation controller, Save As dialog and explorer menu; `apps/shell/src/explorer/ExplorerView.tsx`, `App.tsx`, `workbench/commands.ts`.
- `packages/plugin-sdk/src`: protocol, registration, editor and view clients, types, version.
- Contracts, author guide, security review, accessibility, walkthrough, changelog and roadmap follow-up.
- Tests: template validation and binary decoding, create-only collisions on every provider, Save As cancellation, size messages, reserved names, active-frame gating, concurrent dialog rejection, a11y and the deployed fixture.
