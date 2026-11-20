# Proposal

## Why

Plugins can contribute only file editors. Everything else in the workbench - the activity bar, the left and right side bars, and non-file tabs - is shell-only. A plugin that wants an outline, a generator, a tutorial, an inspector or a repository viewer has to fake it inside a file editor or cannot offer it at all. The workbench kit already supports primary, secondary and panel views, and the shell already positions visible frame surfaces over shell-owned placeholders. What is missing is a plugin contribution model for those surfaces, a view frame mode and the intents a panel needs to drive the rest of the shell.

## What Changes

- Add `contributes.panels` with `location: "primary" | "secondary"`, a title, a Codicon name and an entry page inside the plugin root. A primary panel adds an activity-bar item and a left-panel view; a secondary panel adds a right-panel view.
- Add `contributes.contentViews` for tabbed, read-only plugin surfaces that are not bound to a workspace file.
- Extend `plugin/register` with `panels`, `contentViews` ids so a controller activates a subset, and extend `shell/register-ack` additively.
- Add a `view` frame mode with `exo-mode=view`, a `shell/init.view` block (`kind`, `id`, `title`, `location`, `instanceId`, optional `payload`, optional `openedBy`) and `capabilities.openFile`, `openView`, `requestPanel` and `localEvents`.
- Mount panels lazily on first reveal and retain them while the plugin is active; dispose them on plugin removal or workspace switch. Content-view frames mount per open tab and are disposed when the tab closes.
- Add `plugin/open-file { path }`, `plugin/open-view { pluginId?, viewId, instanceKey?, payload? }` and `plugin/request-panel { panel, action }` for view and editor frames, with correlated `shell/open-result` and `shell/panel-result` replies.
- Allow cross-plugin `open-view` when `pluginId` is supplied. The target receives `openedBy` and a one-shot payload; there is no reverse channel and no cross-plugin local event.
- Cap the `open-view` payload at 64 KiB JSON. An oversized payload is rejected with `too-large` and a message naming the actual size and the limit.
- Derive the primary activity bar and both sidebar registries from the host snapshot. Primary panels switch through the activity bar; secondary panels use shell "Show View" palette entries and a "Select View" header action because the preset activity bar can only activate primary views.
- Render content views as tabs with a contained local tab-kind adapter. They are read-only: no dirty state, no save, no conflict flow. File creation is a separate change.
- Show panels, content views and the new intents in the first-grant consent dialog, but do **not** add them to the consent fingerprint. Existing grants stay valid and a plugin may add a surface without a re-prompt. The shell shows the plugin name in activity-bar tooltips, the secondary-view picker and the content-view chrome so a new surface cannot impersonate the shell.
- Allow view frames to subscribe and publish local events, reusing the `plugin-local-events` API; no second messaging path.
- Add a `ViewClient` to the SDK, registration helpers for panels/content views, the `openFile`/`openView`/`requestPanel` helpers on both clients, and SDK `1.5.0`; shell `0.3.0`.
- Do not fingerprint the new declarations. No new permission is introduced; `open-file` and reads require the existing `workspace:read`.

**Not breaking:** the view mode and messages are additive within protocol major `1`, manifest schema stays `1`, and older shells report `incompatible-engine` for a manifest that sets a suitable `engines.exo`. A plugin without the new contributions behaves exactly as before.

**Explicit non-goals:** editable or saveable content views, arbitrary top-level iframe URLs, generic plugin command execution, plugin-defined header actions, multiple views behind one activity icon, cross-plugin local messaging, and content-view dirty/close prompts.

## Capabilities

### New Capabilities

- `plugin-views`: plugin-contributed panels, content views, lazy frame lifecycle, activity-bar and secondary-sidebar placement, content-view tabs, payloads, and the open-file/open-view/request-panel intents.

### Modified Capabilities

- `plugin-manifest`: adds `contributes.panels` and `contributes.contentViews`, their limits and entry rules, the consent display, and the deliberate fingerprint exclusion.
- `plugin-protocol`: adds the `view` mode, `shell/init.view`, the view/init capabilities and the new correlated messages and limits.
- `plugin-sdk`: adds `ViewConnection`/`ViewClient`, registration helpers, `openFile`, `openView`, `requestPanel`, the support bits and the version bump.
- `editor-shell`: derives the primary and secondary view registries and activity-bar items from plugin registrations, adds content-view tabs and chrome, and records the new accessibility surfaces.
- `plugin-host`: registers panels and content views, exposes them in the host snapshot and log, and tears them down with the plugin and workspace.
- `plugin-events`: allows view frames to subscribe and publish local topics under the same identity and limits as editor frames.

## Impact

- `schema/exo.schema.json`, `apps/shell/src/plugins/manifest.ts`, `registration.ts`, `registry.ts`, `host.ts`.
- A new view pool and shared frame-session base; `frame.ts` surface attachment; `handler.ts`/`handlers.ts` for the shared read path and the new intents.
- `apps/shell/src/App.tsx`, `workbench/config.ts`, `workbench/views.tsx`, `document/DocumentArea.tsx`, `workbench/tabs.ts`, `document/OpenWithDialog.tsx` neighbours and the consent/settings surfaces.
- `packages/plugin-sdk/src`: protocol, handshake, a shared reader/event base, `view.ts`, registration and editor helpers.
- `packages/plugin-template` or the plugin-host fixture for a deployed panel/content-view example.
- Contracts, author guide, security review, accessibility, performance, walkthrough, changelog and roadmap follow-up.
- Tests: view mode handshake, lazy mount, surface bounds, content tab lifecycle, cross-plugin `openedBy`, payload and instance caps, activity-bar fallback, focus/active gates, a11y scans and a no-fingerprint mutation test.
