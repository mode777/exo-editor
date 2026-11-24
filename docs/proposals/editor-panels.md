# Feature proposal: editor-bound panels and bottom panels

**Status:** proposed as the OpenSpec change `editor-bound-panels`.

## Summary

Let a plugin move inspector, property, and validation UI out of its editor frame
into shell-owned panels, including a bottom panel. A panel can follow the active
file editor and exchange plugin-local messages with it. The editor remains the
only owner of the document, history, dirty state, and save flow.

## Problem

`contributes.panels` supports only `primary` and `secondary`. The workbench has a
bottom region, but Exo disables it and wires no plugin views into it. Panels are
singleton plugin views, and Exo 0.9.0 exposes only `activeContentView`; there is
no active file-editor context for a panel.

A panel therefore cannot tell which editor tab is active, cannot see that
editor's unsaved buffer or selection, and cannot apply an edit through its
history. Plugins keep their inspectors and bottom drawers inside the editor
frame, duplicating shell chrome and consuming viewport space.

## Proposed changes

### 1. Add a bottom panel location

- Accept `"bottom"` in `contributes.panels[].location`.
- Wire registered bottom panels through the existing workbench panel registry:
  enable `bottomPanel` when at least one is registered, add the views to
  `WorkbenchViewRegistry.panel`, and show multiple bottom panels as tabs.
- Extend `ViewInitData.location` to include `"bottom"`. The
  `plugin/request-panel` message shape does not change; location stays
  manifest-owned.
- Add a `capabilities.bottomPanel` support bit.

### 2. Expose the active file editor to view frames

Add `activeEditor` to a view frame's `shell/init`, limited to editors handled by
the same plugin:

```ts
activeEditor: {
  pluginId: string
  path: string
  instanceId: string // opaque shell-assigned editor instance id
} | null
```

The editor receives the same `instanceId` in its own init (for example under a
new `editor` block). Add a targeted `editor/active` topic, delivered only to the
plugin's subscribed frames:

- `{ pluginId, active: true, path, instanceId }`
- `{ pluginId, active: false }`

The value is `null`/inactive when the active tab is another plugin's editor, a
plain file, a content view, or no tab. Add a `capabilities.editorContext` bit.
The SDK exposes `view.activeEditor`, the editor's `instanceId`, and types the
topic.

### 3. Use existing local events for the panel ↔ editor channel

Do not add a frame-to-frame message API. Reuse `local/*` events:

1. The panel knows the active editor's `instanceId`.
2. It publishes a local event whose payload includes that target id.
3. Every editor frame receives it; only the matching instance handles it.
4. The editor replies on a local topic with its own `instanceId` as the source;
   the panel filters out inactive editors.

The editor remains authoritative. Panel messages request a snapshot or an edit;
the editor applies edits through its own history, marks the document dirty, and
saves through the normal handler flow. The panel never gets save, dirty, or write
access. Existing local-event size, rate, and at-most-once rules apply. The panel
requests a fresh snapshot on mount and on `editor/active`.

### 4. Keep panel reveal explicit

The editor can reveal its panels with `plugin/request-panel` when it becomes
active. No new automatic companion behavior is required for the first version.
An optional `companion: "activeEditor"` panel rule can follow later if explicit
reveal proves noisy.

## Example

```json
{
  "contributes": {
    "panels": [
      {
        "id": "tenon.inspector",
        "title": "Inspector",
        "location": "secondary",
        "entry": "views/inspector.html"
      },
      {
        "id": "tenon.inspection",
        "title": "Inspection",
        "location": "bottom",
        "entry": "views/inspection.html"
      }
    ]
  }
}
```

## Compatibility

- Additive manifest and protocol fields. Manifest `schemaVersion` stays `1`;
  protocol stays `1`; shell minor `0.10.0`; SDK minor `1.10.0`.
- Older shells reject `"bottom"` as an invalid manifest, so plugins using it
  declare `engines.exo` at or above `0.10.0`. Older SDKs ignore `activeEditor`,
  report the capability bits as false, and keep working.
- No new permission and no consent fingerprint change. Panels are already
  user-invoked surfaces; active editor context is plugin-scoped.
- `editor/active` carries metadata only. Panels keep the existing mediated read
  path and never receive a `File`, `Blob`, or handle. The proposal adds no
  file-content channel; the local-event channel carries selection, edits and
  snapshots as plugin-defined data.

## Non-goals

- Arbitrary docking, floating panels, or user-defined layouts.
- Per-document panel instances; a panel is a singleton that follows the active
  editor.
- Cross-plugin editor binding or cross-plugin local events.
- Direct writes to an editor buffer or a new save path for view frames.
- Output channels or log UI in the bottom panel.
- Changes to content-view companion behavior.

## Acceptance criteria

- A plugin registers a secondary panel and a bottom panel; both appear in their
  shell-owned regions.
- With two editor tabs open, the panels follow the active tab; switching tabs
  updates `editor/active` and the panel shows the new document.
- A panel edit reaches the active editor, becomes undoable, marks the document
  dirty, and saves through the normal save flow.
- When the active tab is not handled by the plugin, the panel receives
  `activeEditor: null` and renders an empty state.
- An older shell rejects the manifest with `incompatible-engine`; an older SDK
  degrades to no active editor context.
- A panel cannot write a file or mutate a hidden editor, and messages stay
  within the existing local-event limits.

## Impact

- `schema/exo.schema.json`, `apps/shell/src/plugins/manifest.ts`, `host.ts`,
  `registration.ts`, `view-pool.ts`, `workspace/runtime.ts`,
  `workbench/config.ts`, `workbench/plugin-views.tsx`, `workbench/views.tsx`.
- `packages/plugin-sdk` view init, event types and helpers.
- `docs/contracts/plugin-manifest.md`, `plugin-protocol.md`, `events.md`,
  `plugin-sdk.md`, the author guide, OpenSpec specs, tests and fixtures,
  `CHANGELOG.md` and `ROADMAP.md`.
