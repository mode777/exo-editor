# Proposal

## Why

A content view can show a related secondary panel today only by calling
`plugin/request-panel` itself. When its tab closes, the shell disposes only that
view frame, so the plugin's other panels cannot learn that the view is gone
without polling or a heartbeat. The association is already known from the
manifest, so the shell should own the reveal and hide lifecycle declaratively.

## What Changes

- Add an optional `companionPanel` to every `contributes.contentViews` entry. It
  names a panel declared in the same manifest, and that panel MUST have
  `location: "secondary"`. An unknown id, a primary panel or an invalid
  contribution id fails manifest validation with `invalid-manifest` and the
  content-view field.
- Carry the association into the registered content view and the host snapshot.
  No new permission, consent fingerprint field, protocol message or SDK API is
  added.
- When a content view opens or is focused, the shell reveals its declared
  companion through the normal secondary-panel path
  (`showSecondaryView(viewId)`). Opening an existing instance with the same
  instance key reveals it again.
- Derive companion visibility from the view pool rather than a mutable
  refcount. After `closeContent`, `closeFor`, `disposeAll` or workspace detach,
  hide the companion only when no open content view still names it. A manual
  hide stays hidden until the next content-view open or focus, and a manual
  open from the view picker remains ordinary panel behavior.
- If the companion panel is not registered in the current session, the content
  view still opens and the reveal is skipped.
- Keep `plugin/request-panel` unchanged. There is no new shell event, plugin
  heartbeat, polling or timeout.
- Update the manifest schema, shell runtime and view pool, host snapshot types,
  unit and fixture tests, contracts and author guide. Shell `0.6.0` adds the
  feature; plugins using it declare `engines.exo` at or above `0.6.0`.

**Not breaking:** the field is optional, manifest `schemaVersion` stays `1`, the
protocol stays `1`, SDK `1.7.0` is unchanged, and existing plugins behave
exactly as before. Older shells reject the unknown field, so a plugin must
declare an `engines.exo` range that includes `0.6.0`; the shell reports
`incompatible-engine` before parsing the new field.

**Explicit non-goals:** a new permission or consent fingerprint change; a
plugin lifecycle event or message; plugin polling, heartbeats or timeouts;
companions for panels or file editors; associating a content view with another
plugin's panel; multiple companion panels per content view; automatic reopening
after a manual hide without a new open or focus; and changes to
`plugin/request-panel` semantics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-manifest`: adds the optional `companionPanel` field to the content-view
  contribution shape, its id validation, same-manifest existence and
  `secondary` location rule, and the engine-version note.
- `plugin-views`: adds the content-view companion lifecycle: reveal on open or
  focus, derived hide after the last matching instance closes, tolerance for an
  unregistered companion, respect for a manual hide, and teardown on plugin
  removal and workspace switch.
- `editor-shell`: adds the workbench behavior for content-view companion
  panels, including tab focus, manual panel visibility and workspace reset.
- `plugin-host`: preserves the companion association on registered content
  views in the workspace-scoped snapshot and removes it with the plugin.

## Impact

- `schema/exo.schema.json`, `apps/shell/src/plugins/manifest.ts`,
  `host.ts`, `registration.ts`, `view-pool.ts`.
- `apps/shell/src/workspace/runtime.ts`, `workbench/tabs.ts` neighbours and the
  content-view surface used for tab focus.
- `apps/shell/src/plugins/manifest.test.ts`, `view-pool.test.ts`,
  `apps/shell/src/workspace/runtime.views.test.ts`,
  `apps/shell/src/workbench/SecondaryViewPicker.test.tsx` and the plugin-host
  fixture manifest/controller.
- `docs/contracts/plugin-manifest.md`, `docs/guide/manifest.md`,
  `docs/releases.md`, `CHANGELOG.md`, `ROADMAP.md` and the shell version.
- Verification: deployed shell `0.6.0`, manifest schema `1`, protocol `1`, SDK
  `1.7.0`; full local gate and deployed acceptance path.
