# Proposal

## Why

The layer 9 Monaco editor is usable, but Ctrl+S inside its iframe does nothing:
keyboard events do not cross the frame boundary and protocol v1 only lets the
shell initiate a save. A plugin can answer a save request but cannot ask for one.
Adding a small, id-less save-intent notification closes that usability gap
without changing who owns writes, versions, conflicts or dirty state.

## What Changes

- Add `plugin/request-save`, an id-less editor-phase notification. It asks the
  shell to run its normal save action for the handler's document. The shell still
  sends `shell/request-save`, still accepts content only in reply to that request,
  and still returns the outcome through `shell/save-result`.
- The shell SHALL coalesce the notification with an existing save, ignore it for
  a clean, read-only or disposed document, and never accept it as a way to supply
  content directly. A notification that carries an `id` is a protocol violation.
- Add `EditorClient.requestSave()` to `@exo/plugin-sdk` and bump the SDK from
  `1.0.0` to `1.1.0` (additive API, protocol major stays `1`).
- Bind Monaco's Ctrl/Cmd+S command in the reference plugin when the document is
  dirty and writable; the existing Save action and all conflict/timeout behavior
  remain unchanged.
- Update the protocol, SDK and file-editor contracts and their specs; no manifest,
  consent fingerprint, sandbox or storage change.

**Not breaking:** the message is additive within protocol major `1` and carries
no content. A shell that predates it ignores it, and the shell Save action still
works.

**Explicit non-goals:** plugin-supplied content without a shell request, a
plugin-controlled `ifVersion`, a new protocol major, dirty-state inference in the
shell, retries, autosave, save-all, multi-file saves, and any change to the
reference plugin's file globs or manifest.

## Capabilities

### New Capabilities

None. This is an additive change to existing editor and protocol behavior.

### Modified Capabilities

- `plugin-protocol`: adds the id-less `plugin/request-save` notification, its
  phase and validation rules, coalescing and the requirement that content still
  answers a live `shell/request-save`.
- `plugin-sdk`: adds `EditorClient.requestSave()` and its additive-version rule.
- `plugin-file-editors`: a plugin can trigger the shell's existing save path for
  its active document without becoming the writer.
- `reference-code-plugin`: Ctrl/Cmd+S inside Monaco triggers the save notification
  when the document is dirty and writable.

## Impact

- `apps/shell/src/plugins/handler.ts`, `handlers.ts` and
  `workspace/runtime.ts`: dispatch the notification to the document store, with
  path-scoped coalescing and no new content path.
- `packages/plugin-sdk/src/editor.ts` and its tests: one id-less send.
- `apps/code-plugin/src/editor.ts`: Monaco Ctrl/Cmd+S binding; README limitation
  removed.
- `docs/contracts/plugin-protocol.md`, `plugin-sdk.md`, the matching OpenSpec
  deltas, and the SDK package version.
- No manifest, schema, consent, CSP, sandbox, deploy or shell-bundle-size change.
