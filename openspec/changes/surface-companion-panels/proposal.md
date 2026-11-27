# Proposal

## Why

The only automatic panel binding today is `contributes.contentViews[].companionPanel`, and it is limited to one secondary panel. A file editor or a bottom/primary panel cannot be revealed and hidden with its tab. Plugins cannot emulate it with `plugin/request-panel`: once the tab is inactive the frame is no longer active and visible, so the hide request is denied.

## What Changes

- Add `companionPanels` (1-3 panel ids) to `contributes.fileEditors` and `contributes.contentViews`; each id names a panel in the same manifest, and a contribution may bind at most one panel per location.
- Allow companions in `primary`, `secondary` and `bottom`; the shell reveals them on the active surface and hides them when the surface changes, keeping panels shared by the next surface.
- Keep `companionPanel` on content views as a one-item compatibility alias; it may not be combined with `companionPanels`. Normalize both forms to one internal list.
- Generalize the existing content-view companion behavior to file editors and all three locations: reveal on open/focus for content views, reveal only after a file editor handler is active, hide on deactivation or last close, skip unregistered panels, respect manual hide and a user-selected other panel, and keep hidden frames mounted.
- Consolidate the shell implementation on one derived companion path. Remove the separate `ViewPool` companion callback and the content-surface reveal effect; the runtime derives companions from the active tab and active handler and applies them through the existing region visibility actions.
- No new protocol message, shell event, SDK API or capability bit. `view/active`, `editor/active` and `plugin/request-panel` keep their shapes and gates; the consolidation is shell-internal.
- Add fixture coverage for a file editor and a content view with companions in all three regions, and update the manifest and view contracts, author guide and release notes.
- Shell `0.11.0`; manifest schema `1`, protocol `1`, SDK `1.10.0`. A manifest that uses the new field must declare `engines.exo` at or above `0.11.0`, as with the bottom-panel location in `0.10.0`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-manifest`: the editor/content-view contribution shape accepts `companionPanels`, the `companionPanel` alias is normalized, and companion ids, count, uniqueness and per-location rules are validated.
- `plugin-views`: the content-view companion requirement becomes a surface-companion requirement covering file editors, multiple panels, all three locations, shared panels and retained frames.
- `plugin-host`: registered file editors expose their companion panels alongside content views, so the runtime can resolve them from a matched contribution.
- `editor-shell`: the workbench companion behavior covers plugin file editors and primary, secondary and bottom regions through the normal region visibility paths.

## Impact

- `schema/exo.schema.json`, `apps/shell/src/plugins/manifest.ts` and `registration.ts` for the new field and normalized registration data.
- `apps/shell/src/workspace/documents.ts` (matched editor metadata), `workbench/tabs.ts` (content-view companion list), `plugins/view-pool.ts`, `workspace/runtime.ts` and `workbench/plugin-views.tsx` for the single companion path.
- `apps/shell/public/plugin-host-fixture/` manifests/pages and example workspace files for the deployed check.
- `docs/contracts/plugin-manifest.md`, the view and panel text in `docs/guide/`, `CHANGELOG.md`, `docs/releases.md`, `README.md`, `AGENTS.md` and `ROADMAP.md`.
- Unit, runtime, view-pool and manifest tests, including removal tests that fail if the companion hide/show path is deleted; no new dependency, backend, permission, consent fingerprint input or workspace-scoped storage.
