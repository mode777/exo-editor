# Design

## Context

See [`proposal.md`](./proposal.md) for motivation and the spec deltas for
required behavior. The current shell already has:

- `ManifestContentView` and a parser in `apps/shell/src/plugins/manifest.ts`
  that rejects unknown contribution fields.
- `RegisteredContentView extends ManifestContentView`; the host snapshot copies
  the registered view with `{ ...view }`.
- `ViewPool` owns panel laziness, content-view tabs, per-plugin caps and all
  teardown paths. It has no dependency on the workbench store.
- `WorkspaceRuntime` owns the workbench store calls (`showSecondaryView`,
  `toggleSecondarySideBar`) and passes registered manifests into `ViewPool`.
- The preset renders only the active tab, so `ContentViewSurface` mounts on tab
  activation and unmounts on tab switch.

The main constraint is that a content view's companion association is declared
metadata, not a new registration kind, permission or protocol message. The shell
must derive all visibility from live records and must not persist a counter that
can drift after a crash, plugin removal or workspace switch.

## Goals / Non-Goals

**Goals:**

- Validate the association once at manifest load and carry it through the
  registered content view and host snapshot.
- Reveal on new open, existing-instance open and tab focus.
- Hide only when the last open content view that declares the companion goes
  away, and only if the companion is still the active secondary view.
- Cover tab close, close-all, `closeFor`, `disposeAll`, plugin removal and
  workspace detach through one derived-state path.
- Keep lazy panel mounting, manual hide and manual picker behavior unchanged.
- Keep compatibility within manifest schema `1` and protocol `1`.

**Non-Goals:**

- A new permission, consent fingerprint input, protocol message, shell event,
  SDK API or manifest schema version.
- Companion associations across plugins, for panels/file editors, or multiple
  companions per content view.
- Reopening a manually hidden companion on unrelated state changes.
- Changing `plugin/request-panel` or adding a plugin-facing lifecycle signal.

## Decisions

### D1 - The manifest is the only declaration; no registration field

`ManifestContentView` gains `companionPanel?: string`. `parseContentViews`
receives the already-parsed `panels` array and, when the field is present:

1. requires a string matching `MANIFEST_CONTRIBUTION_ID_PATTERN` (the same
   pattern and limits as panel ids);
2. resolves the id in the same manifest's `panels` and rejects an unknown id;
3. rejects a panel whose `location` is not `"secondary"`.

The parser error is `invalid-manifest` with the field pointer
`/contributes/contentViews/<index>/companionPanel`. The JSON Schema adds the
same optional field with `$ref: "#/$defs/contributionId"`; JSON Schema cannot
express the cross-reference, so the parser remains authoritative. No
`plugin/register` field is added: the controller registers content-view ids as
before, and `RegisteredContentView` (`extends ManifestContentView`) preserves
the association through its existing spread.

Alternative rejected: a registration-time companion list. It would add another
subset to validate, allow a view to change its association without a manifest
change, and break the rule that dependencies are declared in the manifest.

### D2 - `ViewPool` derives companion changes from its records

`ViewPool` gains one internal observer:

```ts
export interface CompanionPanelChange {
  action: 'show' | 'hide'
  identity: string
  panelId: string
}
```

`ViewPoolOptions.onCompanionPanel?: (change: CompanionPanelChange) => void`.
It is a shell-internal callback, not a plugin message or shell event.

`ContentViewInput.view` gains `companionPanel?: string`. Each content record
retains the input, so a helper reads the companion directly from the record.
Two operations drive the observer:

- **Show** on `openContent`, after the record exists, for both new and existing
  instance keys. A new `revealCompanion(key)` method emits the same change when
  an already-open tab becomes active.
- **Hide** after removal. `hideCompanionIfOrphaned(identity, panelId)` scans the
  remaining records for a content record with that identity and companion; it
  emits a hide only if none remains.

`closeContent` captures the record's companion, deletes the record, then calls
the orphan check. `closeFor`, `disposeAll` and `detach` collect the companions
of the records they are about to remove, clear the records, then hide each
companion that has no remaining user. No integer refcount is stored anywhere;
the answer always comes from the current records.

Alternatives rejected:

- **A runtime scan over workbench tabs.** It duplicates the record lifecycle and
  misses `closeFor`/`disposeAll`/`detach` unless every caller is audited.
- **A refcount in the view handle.** It can drift on a failed close, a plugin
  removal race or a workspace switch, exactly the failure this change avoids.
- **A workbench-store subscription.** It would observe unrelated tab changes and
  make the view pool depend on the preset store.

### D3 - The runtime maps companion changes to the existing panel path

`WorkspaceRuntime` constructs `ViewPool` with `onCompanionPanel: (change) =>
this.applyCompanionChange(change)` and implements:

- **Show**: resolve the live host record by identity, require
  `phase === 'active'`, require the panel in `record.panels` (registered in this
  session) and `location === 'secondary'`, then call
  `showPanel(pluginViewId(identity, panelId), 'secondary')`. The existing
  `showSecondaryView` action makes the secondary side bar visible and activates
  the panel. If any check fails, the show is a no-op and the content view has
  already opened normally.
- **Hide**: read the workbench store. If
  `secondarySideBarVisible && activeSecondaryView === companionViewId`, call
  `toggleSecondarySideBar(companionViewId)`; otherwise do nothing. This is what
  respects a manual hide (already hidden, no toggle) and a user-selected other
  panel (active id differs, no toggle). The panel frame stays mounted.

The runtime passes `view.companionPanel` into both `openContent` call sites:
`openContentViewWithKey` (palette, show-view entries and commands) and
`openViewIntent` (`plugin/open-view`, including cross-plugin opens). This means
an existing instance key reveals the companion again because `openContent` emits
show even when the key already exists. `requestPanelIntent` is untouched.

Alternative rejected: routing the reveal through `plugin/request-panel`. That
path is a correlated plugin intent with source/visibility gates and an
acknowledgement; the shell's own lifecycle should not pretend to be a plugin.

### D4 - Tab focus is covered by the content surface effect

The workbench calls its own `activateTab` directly when the user clicks a tab,
so the runtime never sees that focus change. The preset renders only the active
tab, which means `ContentViewSurface` mounts when a content tab becomes active
and unmounts when another tab becomes active. The surface calls
`runtime.views.revealCompanion(content.key)` in a mount effect keyed by
`content.key`.

`openContent`'s automatic show and the surface effect can both run for the same
open; `showSecondaryView` is idempotent for the same view id. The effect does not
run on unrelated re-renders, so a manual hide while the tab stays active remains
respected until the user leaves and returns to the tab or opens the view again.

Alternative rejected: subscribing the runtime to `useWorkbenchStore` and
diffing `activeTabId`. That adds a second observer of shell state and a teardown
responsibility for no behavior the mount effect does not provide.

### D5 - Teardown order and compatibility

- Tab close/close-all goes through `closeTabs` -> `ViewPool.closeContent`; the
  pool hides an orphaned companion after deleting the record.
- Plugin removal calls `closeViewsFor` -> `ViewPool.closeFor`, which hides the
  companions before the host drops registrations. `closeContentTabsFor` then
  removes the tabs.
- Workspace detach calls `ViewPool.detach`, which hides companions while the
  workbench store and side bar still exist; `clearWorkspaceTabs` runs afterwards.
  A manually selected unrelated panel is untouched because its id is not the
  companion id.
- `disposeAll` uses the same collection-and-hide path even though the runtime
  does not currently call it, so future disposal callers cannot leave a stale
  companion.

The shell package and `SHELL_VERSION` move to `0.6.0`. Manifest `schemaVersion`
stays `1`, protocol stays `1`, SDK stays `1.7.0` because no SDK manifest types
or client APIs change. Older shells reject the unknown `companionPanel` field
through the existing unknown-key validation; plugins using it must declare
`engines.exo` at or above `0.6.0`, and an older shell reports
`incompatible-engine` before parsing the contribution. No consent record
changes because the association adds no autonomous access.

## Risks / Trade-offs

- **Double reveal on open.** `openContent` and the surface mount both reveal the
  same panel. Mitigation: the workbench store action is idempotent and the
  panel is lazy-mounted once; tests assert a single frame and the expected
  active id.
- **Manual hide looks like an orphaned hide.** A hide after close is conditional
  on the companion being the active, visible secondary view. Mitigation: tests
  cover manual hide and a different active panel.
- **A companion is unregistered but declared.** The pool emits show, and the
  runtime skips it because `record.panels` lacks the id. Mitigation: runtime test
  opens a content view with an unregistered companion and asserts the tab and
  ordinary panel behavior still work.
- **Teardown after the host record is gone.** Hide does not depend on the host
  record, only on the workbench store. Mitigation: plugin-removal and workspace
  switch tests check the store after teardown.
- **Subset registration ordering.** A content view and its companion are
  accepted in one registration completion, so the companion is either present
  in `record.panels` or deliberately absent. Mitigation: parser and host tests
  cover both.
- **UI noise from showing the side bar.** Opening a content view intentionally
  reveals the panel; a user who does not want it can hide it once. Mitigation:
  the manual-hide rule and the documented behavior make this explicit.

## Migration Plan

1. Land the schema, parser, view-pool, runtime, tests, fixture, contracts and
   docs in one change on `main`.
2. Bump the shell to `0.6.0`, update `SHELL_VERSION`, `CHANGELOG.md` and
   `docs/releases.md`; keep manifest schema `1`, protocol `1` and SDK `1.7.0`.
3. Push to `main`, let the CI `verify` job deploy, and record deployed
   verification with the fixture URL and commit.
4. Rollback is a normal revert: no data migration, protocol change or consent
   record change is involved. A plugin that declared the field on a `0.6.0`
   shell must still declare the matching `engines.exo` range if rolled back.

## Open Questions

None.
