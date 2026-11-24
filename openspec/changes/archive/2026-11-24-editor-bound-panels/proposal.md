# Proposal

## Why

A plugin inspector or validation panel cannot follow the active file editor.
`contributes.panels` supports only `primary` and `secondary`, the workbench
bottom region stays disabled, and a view frame learns only `activeContentView`.
A panel therefore cannot tell which editor tab is active, see that editor's
unsaved buffer or selection, or apply an edit through its history. Plugins keep
those surfaces inside the editor frame, duplicating shell chrome and consuming
the document viewport.

This change adds the third panel location and the active-editor context a panel
needs, without giving a view frame any file or write authority. The editor
remains the only owner of the document, history, dirty state and save flow. The
source draft is [`docs/proposals/editor-panels.md`](../../../docs/proposals/editor-panels.md).

## What Changes

- Accept `location: "bottom"` in `contributes.panels`. A registered bottom panel
  appears as a tab in the workbench bottom region; the region enables when at
  least one is registered, and only the active tab mounts a frame. The panel
  limit stays eight across all locations.
- Add `capabilities.bottomPanel` to the registration `shell/init`, exposed by
  the SDK as a registration support bit. The manifest `schemaVersion` stays `1`.
- Add `activeEditor` to a view frame's `shell/init`, limited by plugin identity:
  `{ pluginId, path, instanceId }` or `null`. Add `editor.instanceId` to an
  editor frame's `shell/init` and `capabilities.editorContext` to both editor and
  view init. The value is `null` when the active tab is another plugin's editor,
  a shell text file, a content view or no tab.
- Add the targeted `editor/active` shell topic with
  `{ pluginId, active: true, path, instanceId }` or
  `{ pluginId, active: false }`. It is delivered only to the plugin's subscribed
  frames. The editor instance id is the frame's opaque `exo-session`, which is
  also the `from` value on its local events.
- Use the existing `local/*` events for the panel ↔ editor channel. A panel
  publishes a plugin-defined payload containing the target `instanceId`; only the
  matching editor instance handles it; the editor applies an edit through its own
  history, reports dirty and saves through the normal handler flow; the panel
  filters replies by `from` and requests a snapshot on mount and on
  `editor/active`. No frame-to-frame message API is added.
- Keep panel reveal explicit. No automatic companion follows the active editor;
  a visible editor can call `plugin/request-panel` under the existing
  active-and-visible gate. A future `companion` rule is out of scope.
- Shell `0.10.0`, SDK `1.10.0`; protocol `1`, manifest schema `1` unchanged. No
  new permission and no consent fingerprint change.

**Compatibility:** a manifest that uses the bottom location MUST declare
`engines.exo` at or above `0.10.0`, so an older shell reports
`incompatible-engine` before parsing it. An older shell omits `activeEditor`,
`editor` and the new capability bits; a new SDK treats them as `null`/`false`.
An older SDK ignores those additive fields, but a bottom panel requires SDK
`1.10.0` (or a client that accepts the new `view.location` value) because an
older SDK rejects an unknown location. Existing manifests, grants and plugins
that do not use the new fields behave exactly as before.

**Explicit non-goals:** arbitrary docking, floating panels or user-defined
layouts; per-document panel instances; cross-plugin editor binding or local
events; direct writes to an editor buffer or a new save path for views; output
channels or log UI; automatic companion reveal; and changes to content-view
companion behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-manifest`: adds the `bottom` panel location, updates the limit wording,
  keeps companion panels secondary-only, discloses the location in consent, and
  adds the engine-version guard for a manifest that uses the new location.
- `plugin-views`: adds bottom panel placement and tab lifecycle, extends the view
  block location, and adds the active-editor context, init field and local-event
  channel model for view frames.
- `plugin-protocol`: adds `editor.instanceId`, `activeEditor`,
  `capabilities.editorContext`, `capabilities.bottomPanel`, the `bottom` view
  location and the bottom-panel request behavior; the message shapes stay
  unchanged.
- `plugin-events`: adds `editor/active` to the v1 catalog, its targeted delivery
  and producer, and records that an editor's local-event `from` is its instance
  id.
- `plugin-file-editors`: adds the opaque per-frame editor instance id to the
  handler init and its remount rule.
- `plugin-sdk`: exposes `view.activeEditor`, `EditorClient.instanceId`,
  `capabilities.editorContext`, the registration `bottomPanel` bit, the `bottom`
  view location and the typed `editor/active` topic.
- `editor-shell`: enables and derives the bottom region, keeps inactive bottom
  tabs unmounted, adds bottom-panel chrome and accessibility, and tracks the
  active file editor from the active tab and handler state.
- `plugin-host`: preserves a registered bottom panel and its placement in the
  workspace-scoped snapshot.

## Impact

- `schema/exo.schema.json`, `apps/shell/src/plugins/manifest.ts`,
  `registration.ts`, `host.ts`, `frame-session.ts`, `handler.ts`, `handlers.ts`,
  `view-session.ts`, `view-pool.ts`, `events.ts`.
- `apps/shell/src/workspace/runtime.ts`, `workbench/config.ts`,
  `workbench/plugin-views.tsx`, `workbench/views.tsx`, `ConsentDialog.tsx`.
- `packages/plugin-sdk` protocol, init parsing, editor/view clients, registration
  capabilities and version.
- The deployed plugin-host fixture, the author guide, contracts, OpenSpec specs,
  tests, security/accessibility/performance/walkthrough records, `CHANGELOG.md`,
  `ROADMAP.md`, `README.md` and `AGENTS.md`.
- Verification: the full local gate and the deployed fixture path for a secondary
  panel, a bottom panel, two editor tabs, an editor-bound edit and a non-plugin
  active tab; older-shell and older-SDK behavior is covered by unit tests.
