# Proposal

## Why

Some multi-file repairs cannot be driven by a user picking one path at a time.
After a rename, a glTF importer may want to scan the model's directory for
candidate buffers or textures; a Markdown or HTML editor may want to show the
siblings that actually exist. The plugin protocol currently has no discovery
primitive at all: reads are exact-path only, so a plugin can only guess names or
ask the user to type them blind.

This change adds a narrow, permissioned directory-listing capability. It is
deliberately separate from the user-mediated file picker: the picker grants a
path through a shell dialog, while listing grants a standing ability to enumerate
one directory at a time. The separate permission makes that difference visible
in consent and re-prompts existing readers before they gain discovery.

## What Changes

- Add the `workspace:list` manifest permission. It SHALL require
  `workspace:read`; a handler needs read to exist and to use the results. Existing
  plugins keep their current consent until they add the permission.
- Add `plugin/request-list` (editor phase, correlated) and
  `shell/list-result`. The request carries a workspace directory and an optional
  opaque cursor; the reply carries one bounded page of entries and an optional
  `nextCursor`.
- Listing SHALL be one directory level only. Recursive traversal, globbing and
  search are deferred. The plugin can walk subdirectories with repeated requests.
- Entry shape SHALL be minimal: `{ path, kind: 'file' | 'directory', size? }`.
  The shell SHALL NOT return `mtime`, content versions, content, handles,
  `File`/`Blob` objects or bytes.
- The shell SHALL serve pages from a workspace-scoped, handler-bound snapshot
  cache, filter reserved paths through `forPlugin(pluginId).list`, sort
  deterministically and cap each page at 1,000 entries. An expired or invalid
  cursor SHALL return `not-found`; the plugin re-lists.
- Add an optional `capabilities.directoryListing` support bit to editor
  `shell/init`. Old shells omit it; the SDK treats absence as `false`.
- Add `EditorClient.listDirectory(path, options?)` to `@exo/plugin-sdk` as the
  next additive minor (`1.3.0` when `plugin-file-picker` is present) while the
  protocol major stays `1`.
- Update the manifest schema, validator, consent text, fingerprint test,
  protocol/SDK contracts, author guide and fixture.

**Not breaking:** the message, support bit and permission value are additive
within protocol/manifest major `1`. A shell that predates the message answers
`unsupported-message`; a plugin keeps exact-path reads and, when the picker
change is present, the user picker as its fallback. Existing manifests remain
valid.

**Explicit non-goals:** recursive listing, glob or full-text search, content or
metadata beyond path/kind/size, a new provider method, a `WorkspaceAccess.list`
signature change, whole-tree watching, background frames, listing without
`workspace:read`, and any change to read/write limits or save ownership.

## Capabilities

### New Capabilities

None. This extends the existing handler, manifest, protocol and SDK behavior.

### Modified Capabilities

- `plugin-manifest`: adds the `workspace:list` permission, its dependency on
  `workspace:read`, the consent text and the fingerprint re-prompt scenario.
- `plugin-protocol`: adds `plugin/request-list`/`shell/list-result`, the
  `directoryListing` support bit, `not-a-directory`, pagination, snapshot,
  reserved-path, timeout and rate-limit rules.
- `plugin-file-editors`: a handler may enumerate one directory at a time when
  the plugin declares `workspace:list`, receiving paths and minimal metadata
  only, with reads still mediated by `plugin/request-file`.
- `plugin-sdk`: adds `EditorClient.listDirectory()` and the support/permission
  preflight and pagination contract.

## Impact

- `apps/shell/src/plugins/handler.ts`, `handlers.ts`, `manifest.ts` and protocol
  plumbing: message dispatch, permission check, snapshot cache, pagination,
  timeout and cursor validation.
- `packages/plugin-sdk/src/protocol.ts`, `init.ts`, `editor.ts` and tests: the
  permission union, `directoryListing` bit, `listDirectory()` and version bump.
- `schema/exo.schema.json`, the manifest validator, `ConsentDialog.tsx`,
  `docs/contracts/plugin-manifest.md`, `plugin-protocol.md`, `plugin-sdk.md`,
  the author guide and fixture manifests/editors.
- Tests: permission and mutation tests, pagination/snapshot expiry, reserved
  paths, missing directories, timeout/rate limits, SDK conformance and fixture
  deployment.
- No `workspace-api.md` change: the broker uses the existing `forPlugin.list`
  and bounds the protocol page. No manifest `schemaVersion` bump.
