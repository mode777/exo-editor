# Design

## Context

See [`proposal.md`](./proposal.md) for motivation and the spec deltas for required behavior.

The current shell has three companion paths that grew independently:

- `ManifestContentView.companionPanel` is parsed in `apps/shell/src/plugins/manifest.ts` and restricted to a secondary panel.
- `ViewPool` emits `CompanionPanelChange` on content open and orphaned close, and `WorkspaceRuntime.applyCompanionChange` maps those to the secondary side-bar actions.
- `WorkspaceRuntime.setActiveTab` separately follows the active content view, shows or hides its secondary companion, and calls `syncActiveEditor`.
- `ContentViewSurface` calls `revealCompanion` on mount for the tab-focus case.

File editors already expose an active handler identity through `DocumentEditor`, `HandlerPool` and `syncActiveEditor`; the active editor context is published as `editor/active`. Panels already have three locations and one visibility action per region. The new binding can be derived from state the shell already owns, so it does not need a plugin message or a second lifecycle.

Constraints:

- Manifest `schemaVersion` stays `1`, protocol stays `1`, SDK stays `1.10.0`.
- No new permission, consent fingerprint input or workspace-scoped storage.
- The shell owns layout; a plugin must not be able to mutate a hidden frame's layout.
- Behaviour is verified against the deployed Pages URL, never a local server.

## Goals / Non-Goals

**Goals:**

- One declarative companion shape on file editors and content views, with multiple panels and any panel location.
- One shell-internal resolver and one apply path for all companions, driven by the active surface.
- Preserve the existing content-view companion behaviour, including manual hide, shared panels, lazy frame retention and teardown.
- Keep `plugin/request-panel` as the only imperative panel API, unchanged.

**Non-Goals:**

- Unifying `view/active` and `editor/active` into one topic. That needs a protocol major and is not needed for a shell-derived layout feature.
- A new `panel/visibility` event, heartbeat or polling channel.
- Per-document panel instances, docking, floating panels or user-defined layouts.
- Changing the consent fingerprint, permissions or sandbox for a companion.
- Moving keyboard focus when a panel reveals automatically.

## Decisions

### D1 - A single `companionPanels` list; `companionPanel` stays as an alias

`contributes.fileEditors[]` gains `companionPanels?: string[]`. `contributes.contentViews[]` gains `companionPanels?: string[]` and keeps `companionPanel?: string` for manifests written for shell `0.6.0`-`0.10.x`. The parser normalizes both content-view forms to one list and rejects an entry that uses both.

Validation rules:

- 1-3 ids, each matching the panel-id form and naming a panel in the same manifest.
- Unique ids and at most one panel per `primary`, `secondary` and `bottom` location. A region renders one active view, so binding two panels to one region has no unambiguous reveal.
- Any of the three locations is allowed. The old "must be secondary" rule is removed.
- A panel may be shared by several contributions. The companion is a binding, not a panel copy.

Alternatives rejected:

- **Keep `companionPanel` and add a second file-editor field.** Cannot express multiple companions or the same validation rules without two code paths.
- **Add a top-level `contributes.panelBindings` array.** Introduces another contribution namespace and consent surface for no extra expressiveness.
- **Allow several companions per region.** The workbench can show only one active view per region; validating uniqueness is simpler than defining an activation order.

The JSON Schema gets the optional array and the legacy field; the parser remains authoritative for cross-references and location uniqueness because JSON Schema cannot express them.

### D2 - Normalize once at the registration boundary

The parsed manifest, `RegisteredEditor`, `RegisteredContentView`, the host snapshot, `DocumentEditor` and `ContentViewTabInfo` all carry the same normalized `companionPanels: string[]`. The registration message is unchanged: a controller still registers editor globs, panel ids and content-view ids; the host copies the declaration metadata from the manifest.

`DocumentEditor` gains the field when a document opens with a plugin candidate, so the runtime can read the matched contribution's companions without a second registry lookup. A content tab carries the list from `ManifestContentView` through `openContent`.

Alternative rejected: resolving companions from `ManifestFileEditor` at runtime by entry URL or label. That duplicates candidate resolution and would be wrong when two contributions share a page.

### D3 - `WorkspaceRuntime` owns one derived companion state

Add an internal `SurfaceCompanions` value:

```ts
interface SurfaceCompanion {
  identity: string
  panelId: string
  location: 'primary' | 'secondary' | 'bottom'
}

interface ActiveSurface {
  key: string
  companions: SurfaceCompanion[]
}
```

`key` is stable for one active instance:

- content view: `content:<identity>:<viewId>:<instanceKey>`
- file editor: `editor:<identity>:<path>:<instanceId>`
- no surface: `null`

`syncCompanions()` computes the next surface from `activeContent` (already tracked by `setActiveTab`) and `activeEditor` (already computed by `syncActiveEditor`), then:

1. If the next surface key equals the last applied key, do nothing. This is what preserves a manual hide across dirty/save/theme changes.
2. Hide each previous companion that is not in the next set, but only when that panel is still the active visible view in its region.
3. Show each next companion through the normal region action. Showing is idempotent for the same panel.
4. Store the new key.

The runtime calls `syncCompanions()` after both active-content and active-editor state are current. `setActiveTab` already runs `syncActiveEditor`; the early return in `syncActiveEditor` must still reach the companion sync. An explicit content-view open (`openContentViewWithKey`, including an existing instance) forces the show step even when the key did not change, preserving "open or focus reveals again".

Region actions:

- show primary: `showPrimaryView(viewId)`; hide: `togglePrimarySideBar(viewId)` only when `primarySideBarVisible && activePrimaryView === viewId`.
- show secondary: `showSecondaryView(viewId)`; hide: `toggleSecondarySideBar(viewId)` only when the secondary region is visible on that view.
- show bottom: `showPanelView(viewId)`; hide: `toggleBottomPanel()` only when `bottomPanelVisible && activePanelView === viewId`.

The hide checks are the existing manual-hide and user-selected-panel rules. Closing a region is intentional; the manual selection of another panel in the same region is never touched.

Alternatives rejected:

- **A refcount per panel.** It drifts on close, failure, plugin removal and workspace switch, and cannot tell which surface should win.
- **Drive visibility from `view/active` or `editor/active` subscriptions.** These are plugin-facing events, not shell state, and they are not delivered to the shell itself. The shell already has the authoritative state.
- **Keep the view-pool callback for open/close and add a second runtime path for editors.** Two owners produce conflicting show/hide orderings when a file editor and content view share a panel.

### D4 - Remove the redundant companion paths

- Remove `CompanionPanelChange`, `ViewPoolOptions.onCompanionPanel`, `showCompanion`, `companionsOf`, `hideOrphanedCompanions` and the calls in `openContent`/`closeContent`/`closeFor`/`disposeAll`/`detach`.
- Remove the `ContentViewSurface` reveal effect.
- Keep `ViewPool.openContent` returning the opened key and keep `runtime.setActiveTab(opened.key)` as the single trigger after an open.
- Keep `runtime.openContentViewWithKey` as the explicit force-reveal path for reopening an already-open instance.

This makes tab state, open/close and teardown converge on `setActiveTab` plus `syncActiveEditor`. Tests that currently assert the view-pool callback are rewritten to assert the runtime's region state instead.

### D5 - No new protocol event or command; consolidate only the implementation

The investigation of a unified event concluded against a protocol change:

- `view/active` and `editor/active` have different payloads (`viewId`/`instanceKey` versus `path`), different lifecycle timing and existing protocol-1 consumers. Replacing them with `surface/active` would be a breaking protocol major for no companion benefit.
- Companion visibility is fully derivable from shell state. A new event would create a second source of truth and a delivery burden for something the shell already decides.
- A `plugin/bind-panel` command would be stateful, would need an unbind path from a frame that is already hidden, and would reintroduce the active-and-visible race this change removes.

`plugin/request-panel` remains the imperative API with its existing shape and gate. It shares the region actions internally with the companion path but is not redefined as a lifecycle mechanism.

### D6 - Timing, manual control and focus

- A content-view companion reveals when the tab opens or becomes active; the frame does not need to be ready.
- A file-editor companion reveals only after its handler is active, the same point `editor/active` is published. A mounting or failed handler reveals nothing.
- Switching between two files of the same contribution keeps the companions; switching to another contribution diffs the sets.
- A manual hide lasts until the surface key changes. Leaving and returning to the tab, reopening a content view, or a handler remount changes the key and reveals again.
- Revealing never moves keyboard focus. The shell changes region visibility and the active view id only.
- Unregistered or missing panels are skipped without blocking the tab.
- Workspace switch and plugin removal hide everything and dispose frames through the existing teardown paths.

### D7 - Compatibility and release axes

- Shell `0.11.0` and `SHELL_VERSION = '0.11.0'`.
- Manifest schema `1`, protocol `1`, SDK `1.10.0` (no SDK API or type change).
- A manifest using `companionPanels` or a non-secondary `companionPanel` must declare `engines.exo` at or above `0.11.0`; older shells reject the unknown field or the location as `invalid-manifest`/`incompatible-engine`, matching the bottom-panel precedent.
- `companionPanel` on a secondary content-view panel remains accepted and behaves as a one-item list.
- No consent fingerprint change: panels and editors are already approved surfaces, and the binding grants no file, network or storage access.
- No workspace-scoped persistence is added; the derived state resets with the workspace session.

## Risks / Trade-offs

- **Primary companions can replace the explorer.** → The user selected primary explicitly in the manifest; a user-selected other primary view is never closed, a manual hide persists, and the fixture and guide document the behaviour.
- **Auto-reveal is noisy for frequent tab switches.** → The feature is opt-in per contribution; companions only follow the active surface, and manual hide survives until refocus.
- **Two files of the same plugin can share companions while a third declares different ones.** → Diffing the previous and next sets avoids flicker and covers contribution changes.
- **Removing the view-pool observer regresses open/close behaviour.** → Runtime tests cover open, reopen, close, close-all, plugin removal, workspace switch and shared-panel cases; mutation tests fail if the hide/show path is removed.
- **A manual hide could be undone by an unrelated sync.** → The surface-key guard; tests assert dirty, save and theme changes do not reopen the panel.
- **File-editor companions reveal later than content-view companions.** → Expected: the handler must be active before its panel can rely on `activeEditor`. The guide states the difference.
- **Bottom-panel hide semantics are conditional.** → Hide only when the companion is the active bottom tab; tests cover another bottom tab being active.
- **Hidden frames may still be mounted.** → Existing lazy-mount and budget rules already cover retained frames; no new frame type is introduced.

## Migration Plan

1. Add the schema field and parser/validation, normalize `companionPanel` and `companionPanels`, and carry the list through registration, `DocumentEditor` and content tabs.
2. Implement `syncCompanions` and the region actions in `WorkspaceRuntime`; remove the view-pool callback and the content-surface effect.
3. Update `workbench/plugin-views.tsx` only if the derived list requires a render change; keep frame positioning and shell-owned chrome unchanged.
4. Update the fixture, example files, contracts, author guide, release notes, changelog, roadmap follow-up and the `create-exo-plugin` skill checklist.
5. Bump shell/package versions, run the full CI `verify` gate, push `main`, and record the deployed commit, date and observations here.
6. Rollback is a normal revert. A manifest that used the new field on a `0.11.0` shell must keep a matching `engines.exo` range if the shell is rolled back.

## Deployed Verification (2026-11-27)

Run against deployed commit `153ae29` (shell asset `index-DesB5Poj.js`) at
`https://mode777.github.io/exo-editor/` with `chrome-headless-shell`
131.0.6778.264 at 1440x900. The deployed fixture manifest
`https://mode777.github.io/exo-editor/plugin-host-fixture/exo-manifest.json`
(version `1.4.0`, `engines.exo >=0.11.0`) was the real artifact. The workspace was
an OPFS directory exposed through a `showDirectoryPicker` stub, containing
`exo.json`, `notes.txt`, `other.bound.txt`, `demo.companion.txt` and
`second.companion.txt`; a second stub workspace supplied the switch. No local dev
server or local build was used.

Passed:

- Opening `demo.companion.txt` revealed the primary **Fixture Panel**, secondary
  **Fixture Inspector 2** and bottom **Fixture Inspection** only after the
  handler was active. The regions were closed before the file opened.
- Clicking the `notes.txt` tab hid all three companions; returning to the editor
  revealed them again.
- Hiding **Fixture Inspector 2** manually kept it hidden through a same-surface
  update; leaving and returning to the tab revealed it again.
- Opening `second.companion.txt` kept the same companions for the shared
  contribution. Opening `other.bound.txt` hid the secondary and bottom
  companions and left the user-selected Explorer primary view alone.
- **Fixture Gallery** revealed the primary, secondary and bottom companions from
  its `companionPanels` list; returning to the editor switched the secondary
  companion from **Fixture Inspector** to **Fixture Inspector 2**.
- The legacy **Fixture Tutorial** `companionPanel` alias still revealed
  **Fixture Inspector**.
- Switching to a second OPFS workspace cleared the tabs and left all companion
  regions hidden. Removing the fixture through **Plugin configuration → Remove**
  hid every companion while the remaining editor tab was still open.
- Browser console and page errors were empty. Screenshots
  `~/exo-verify/surface-editor-companions.png`,
  `surface-gallery-companions.png`, `surface-workspace-switch.png` and
  `surface-plugin-removed.png`, plus the JSON report
  `~/exo-verify/surface-report.json`, are on the verification host.
- The CI `verify` job and Pages deploy passed. The bundle measured
  176,361/178,000 gzip js and 13,788/14,000 gzip css.

## Open Questions

None.
