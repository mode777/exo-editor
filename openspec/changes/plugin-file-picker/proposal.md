# Proposal

## Why

Plugins can read a workspace file only when they already know its exact path.
Multi-file formats routinely reference siblings by relative name - glTF buffers
and textures, HTML images, Markdown links, `.obj`/`.mtl` pairs - and after a
rename or a move the plugin cannot discover which paths still exist. The only
fallback today is asking the user to type a path blind and validating it by
trial reads.

The shell already owns the workspace and can list it, and every reader has the
reserved `capabilities.requestFiles` bit. This change gives that bit a real
meaning: a visible, active handler can ask the shell to open a workspace file
picker, and receives only the paths the user explicitly selected.

## What Changes

- Add `plugin/request-files` (editor phase, correlated) and
  `shell/files-selected` (reply with `/`-rooted workspace paths only). An empty
  `paths` array means the user cancelled.
- The shell SHALL render the picker over the active workspace, filter reserved
  entries through the plugin-scoped workspace facade, and return no handles,
  `File`/`Blob` objects, stats or content. The plugin reads selected paths
  through the existing `plugin/request-file` flow.
- Only an active, visible, focused handler may ask. The shell SHALL serialize
  pickers globally, reject concurrent requests with `rate-limited`, close the
  picker without a reply on disposal or workspace switch, and re-check reserved
  paths before replying.
- Add an optional `capabilities.filePicker` support bit to editor `shell/init`.
  `capabilities.requestFiles` remains the permission bit. Old shells omit
  `filePicker`, so the SDK treats it as `false` instead of trusting
  `requestFiles`, which older shells already advertise.
- Add `EditorClient.requestFiles()` to `@exo/plugin-sdk` and bump the SDK from
  `1.1.0` to `1.2.0`. The helper rejects locally when the support bit is absent
  or the plugin lacks `requestFiles`, and maps `unsupported-message` to a stable
  error for shells that predate the message.
- Add the shell picker surface: fixed shell-owned disclosure naming the plugin,
  no plugin-supplied title or text, keyboard operation, focus trap, Escape to
  cancel, and bidi-safe path rendering.

**Not breaking:** the messages and the capability field are additive within
protocol major `1`. A shell that predates them answers `unsupported-message`;
the plugin keeps manual path entry as its fallback. There is no manifest,
schema, permission or consent-fingerprint change, because the user approves
each selected path in shell UI and the plugin already needs `workspace:read` to
read it.

**Explicit non-goals:** autonomous directory listing, recursive traversal,
globbing or search; returning content, metadata, versions or handles from the
picker; plugin-supplied picker text or default selections; hidden or inactive
handlers; a new permission; background frames; and any change to read limits,
save ownership or `workspace-api.md`.

## Capabilities

### New Capabilities

None. This is an additive change to existing handler, protocol and SDK behavior.

### Modified Capabilities

- `plugin-protocol`: adds `plugin/request-files` and `shell/files-selected`, the
  editor-phase rules, the `filePicker` support bit, validation, cancellation,
  concurrency and limit behavior.
- `plugin-file-editors`: a handler can ask the shell for a user-selected set of
  workspace paths, subject to active-frame, reserved-path and lifecycle rules;
  content still moves only through `plugin/request-file`.
- `plugin-sdk`: adds `EditorClient.requestFiles()` and the feature-detection and
  fallback rules for shells that predate the message.

## Impact

- `apps/shell/src/plugins/handler.ts`: dispatch, validation, active-frame gate,
  picker coordination and `shell/files-selected`.
- A new shell picker surface (likely under `apps/shell/src/document/` or
  `apps/shell/src/workspace/`) using the existing modal/focus-trap pattern and
  the plugin-scoped workspace facade.
- `packages/plugin-sdk/src/editor.ts`, `protocol.ts`, `init.ts` and tests:
  `requestFiles()`, the `filePicker` bit and the `1.2.0` version bump.
- `docs/contracts/plugin-protocol.md`, `plugin-sdk.md`,
  `plugin-file-editors`-related author documentation, the `workspace:read`
  consent text in `ConsentDialog.tsx` and the matching OpenSpec deltas.
- Tests: handler picker flows, reserved-path mutation test, inactive/disposed
  frames, old-shell fallback, SDK conformance and an accessibility check for the
  new dialog.
- No manifest schema, consent fingerprint, sandbox, CSP, deploy or
  shell-bundle-size change.
