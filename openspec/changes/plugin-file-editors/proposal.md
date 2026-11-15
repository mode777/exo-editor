# Proposal

## Why

Layer 4 proves consent, sandboxing and registration, but deliberately mounts no
handler frame and never touches file content. Layer 5 is where a third-party
editor first edits the user's bytes, so every invariant the contracts promise
becomes real here: one frame per open document, metadata-only initialization,
content only on request, reserved paths denied at the session, opaque save
content, and teardown on close, removal and workspace switch. Building it now is
the point of the plugin architecture; deferring it would leave the registry with
no consumer and the protocol's handler half unimplemented.

## What Changes

- Route document opens through the editor registry: match the path, select the
  highest-priority candidate using the existing declaration-order tie-break, and
  mount one handler frame for the selected editor. No match, a disabled plugin, a
  failed frame or the 20-frame cap keeps the shell's existing text renderer.
- Add the handler session: a hidden, sandboxed iframe per open document loaded
  from the registered editor entry, the same origin/source validation and opaque
  origin rules as registration, `plugin/ready` then a metadata-only `shell/init`,
  the ready timeout and violation budget, and remount on reopen.
- Add mediated reads: resolve relative paths against the handler file's
  directory, normalize and containment-check, deny reserved paths and missing
  `workspace:read`, enforce `maxRequestBytes`, cache by version, re-stat on first
  request and after an external change, and map failures to the protocol's error
  codes without leaking content or unrelated paths.
- Add plugin-owned document state: dirty state comes from `plugin/dirty` and
  drives the tab dot, close prompt and unload warning; save is a
  `shell/request-save`/`plugin/save-content` round trip with one queued request,
  a 5 s timeout, and an `ifVersion` write of the exact returned text or bytes;
  conflict and deletion leave the tab dirty instead of overwriting or recreating.
- Forward external changes to the handler, never auto-reload a dirty buffer, and
  fail a save after deletion with `not-found`.
- Tear down on tab close, plugin removal, disable or revocation, and workspace
  switch, with save cancellation and no messages accepted after `shell/dispose`.
- Add editor eligibility rules the contracts leave implicit: an editor
  contribution requires `workspace:read`, a save requires `workspace:write` and a
  writable session, and a read-only plugin editor still opens without exposing a
  Save action. Selection is format-agnostic: the shell does not decode or sniff
  the file before mounting a handler.
- Give "Open with..." a real surface: when several contributions match, the
  candidate list is offered per document, and choosing an alternative re-mounts
  that document's handler without changing the registry.
- Extend the stub fixture into a working editor that exercises read, repeated
  reads, dirty, save, conflict and dispose-ack, plus a never-ack variant for the
  teardown timeout, and verify the layer against the deployed shell.

**Explicit non-goals:** the events topic bus, plugin-declared settings, the typed
SDK and template, the Monaco reference plugin, multiple simultaneous handlers per
document, background plugin frames, plugin-to-plugin messaging, LSP and terminal
integration.

## Capabilities

### New Capabilities

- `plugin-file-editors`: per-document handler sessions and the shell-side editing
  behavior they own - editor selection and fallback, mediated reads, dirty state,
  save round trips, external changes and teardown.

### Modified Capabilities

- `plugin-protocol`: states that an editor contribution requires `workspace:read`,
  that a save requires `workspace:write` and a writable session, that a missing
  permission yields `permission-denied` with no write, and that handler selection
  is format-agnostic rather than gated on the shell's text decoding.
- `editor-shell`: scopes the binary/undecodable/oversized no-editor state to files
  no plugin editor handles, so a plugin-backed document is not forced into the
  shell text fallback's verdict.
- `plugin-host`: rewords the registration-layer file-access restriction so it is
  scoped to registration frames instead of "this layer", and states that handler
  frames are the only path to content.

## Impact

- New source under `apps/shell/src/plugins/`: the handler session state machine and
  the per-document editor router/pool (frame budget, permissions, lifecycle).
- Changed: `DocumentStore` and its state model (plugin-backed documents, dirty
  from the plugin, save routing, external-change forwarding), the document area
  and tab surfaces, `WorkspaceRuntime` composition and teardown, the host (expose
  candidate permissions and close handler frames when a plugin stops), and the
  manifest types.
- Tests: handler session protocol, path resolution and containment, permission
  gates, save/conflict/timeout, teardown on every reason, frame cap, fallback and
  a test that fails when the reserved-path or origin check is removed.
- Fixtures: the stub plugin gains a real editor page plus conflict and never-ack
  variants; the deployed copy stays available for same-origin verification.
- Documentation: `docs/contracts/plugin-protocol.md`,
  `docs/contracts/plugin-manifest.md`, the matching OpenSpec deltas, and the
  roadmap/agent status on completion.
- No backend, proxy, secret or new runtime dependency. File content still never
  reaches a plugin except as the answer to a request with a live id.
