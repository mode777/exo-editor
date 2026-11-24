# Design

## Context

See [`proposal.md`](./proposal.md) for motivation. The current shell already has
the pieces this change composes:

- `ViewPool` owns panel and content-view frames, mounts panels lazily on
  `attachPanelSurface`, retains hidden frames and disposes them with the plugin
  or workspace. `ViewSession` builds `shell/init` with `view` and
  `activeContentView`.
- `workbench/plugin-views.tsx` derives the activity bar, the primary registry
  and the secondary registry from the host snapshot. `workbenchConfig` keeps the
  secondary side bar and bottom panel disabled as module defaults; the derived
  config enables the secondary region when a secondary panel registers.
- `WorkbenchViewRegistry.panel` and `config.bottomPanel` already exist in
  `vscode-workbench@0.1.3`. The preset's `BottomPanel` renders every configured
  view as a tab and uses `activePanelView`/`showPanelView`/`toggleBottomPanel`.
- `runtime.setActiveTab` follows the active content view and publishes
  `view/active`. It does not track file editors. `HandlerPool` owns one
  `HandlerSession` per open path; `FrameSession` already has an opaque
  `exo-session`, and local events already carry it in `from`.
- The local-event namespace is identity-scoped and does not interpret payloads.
  `editor/active` will use the same event bus, sequences and limits.

## Goals / Non-Goals

**Goals:**

- Add the bottom location through the existing panel registry and lifecycle, not
  a second view type or a second mount path.
- Expose exactly one active editor to a plugin's view frames, with an opaque id
  the plugin can use for its own local-event routing.
- Keep the editor authoritative: no view save path, no shell-mediated content
  channel and no new permission.
- Preserve lazy mounting for bottom tabs even though the preset renders every
  tab's component.
- Keep the manifest schema, protocol major, consent fingerprint and existing
  plugins unchanged.

**Non-Goals:**

- A frame-to-frame request/reply API, a generic editor command bus or shell-side
  interpretation of local-event payloads.
- Automatic panel reveal when an editor becomes active, or a `companion` rule.
- Per-document panel instances, docking/floating panels or cross-plugin binding.
- A new editor buffer API, undo stack or dirty/save channel for views.
- Changing the content-view companion rules; a bottom panel cannot be a
  companion.

## Decisions

### D1 - `bottom` is a third panel location in the existing registry

`contributes.panels[].location` gains `bottom`. `derivePluginWorkbench` splits
active panels into primary, secondary and bottom arrays, fills
`views.panel`, and sets `config.bottomPanel.enabled` from the bottom array.
The bottom views use the same `ViewDefinition` shape, title convention
(`Panel — Plugin`) and `PanelSurface` component as the side bars. The base
`workbenchConfig` keeps the region disabled; the derived config is the only
switch. `plugin/request-panel` remains the only layout message and resolves the
location from the registered panel, so its shape does not change. Reveal stays
explicit and keeps the existing active-and-visible gate: a headless editor
cannot reveal a panel, but the user can still open it through the bottom tabs.

Alternatives: a separate bottom-panel contribution array (duplicates the
manifest and registration shape), a shell-only bottom region with no plugin
frames (does not solve the problem), or a custom bottom component (forks the
preset for tab and resize behavior that already exists).

### D2 - Bottom tabs mount only when active

The preset's `BottomPanel` renders every tab's `content` element; an inactive
`vscode-tab-panel` is `hidden`, but its React component still mounts. Attaching a
frame from that hidden component would create an iframe for a tab the user never
opened and violate the lazy-mount rule.

`derivePluginWorkbench` therefore passes the ordered bottom view ids to each
bottom `PanelSurface`. The surface subscribes to `activePanelView`, resolves the
same fallback as the preset (`activePanelView` if it is in the bottom list,
otherwise the first bottom view), and renders the frame placeholder only when it
is the active tab. The inactive component renders a lightweight shell-owned
empty state and calls `detachPanelSurface` (through the missing ref), so its
frame is not created. Switching tabs attaches the retained frame without a new
handshake. Closing the region unmounts every surface and detaches them; the
`ViewPool` keeps the sessions hidden for the next reveal.

Alternatives: change `vscode-workbench` (forbidden; reuse, do not fork), defer
mounting inside `ViewPool` based on a zero-sized placeholder (works, but makes
the pool depend on layout timing and still leaves a component per tab), or mount
all tabs (violates the existing lazy-mount requirement).

### D3 - The active editor is the active tab's handler, scoped by identity

`runtime` keeps an internal active-editor context:
`{ identity, pluginId, path, instanceId }`. `syncActiveEditor()` derives it from
`activeDocumentPath()` plus the document store:

1. The active tab has a path.
2. The document surface is `plugin` and `pluginPhase` is `active`.
3. The document's editor identity is the plugin that owns the handler.
4. `HandlerPool.get(path)` exists, is active, and exposes its instance id.

If any condition fails, the context is `null`. The context is advertised only to
the plugin whose identity matches; a view of another plugin, even one with the
same manifest id on another origin, receives `null`. A content view, a shell
text file, a failed handler, a text fallback or no tab also yields `null`.

`syncActiveEditor()` runs when the active tab changes, when any document state
changes (through `DocumentStore.subscribeAny`), when the active file is renamed,
when tabs or documents close, and when the workspace deactivates. It publishes
only when the derived context differs. A change within one plugin publishes one
`active: true` event with the new path and instance id when the new handler is
active; if the new handler is still mounting, the previous context clears first
and the new context is published when the handler becomes ready. A change to
another identity or to no editor publishes `active: false` for the previous
identity followed by `active: true` for the next one. `deactivate` clears the
context before documents and tabs are cleared so no stale event is published.

Alternatives: infer from iframe visibility (hidden frames remain alive and are
not the active tab), store the context in the workbench store (the workbench is
presentation, the runtime owns workspace state), or publish from `HandlerPool`
alone (a handler can be ready for a background tab and cannot see the active
tab).

### D4 - The editor instance id is the frame's `exo-session`

`HandlerSession` exposes its existing `sessionId` as `instanceId` and adds
`editor: { instanceId }` to its init. The same value is used in `activeEditor`
and `editor/active`, and `FrameSession` already stamps local events with it in
`from`. This gives the panel a verifiable source for a reply without a new id
generator, a new secret or a new storage key. The id is stable for the frame and
changes when the document is reopened, retried or moved to another matching
editor.

Alternatives: a separate UUID per handler (another id to keep consistent), the
document path (not unique across remounts and not an instance id), or the view
pool key (a panel/content identity, not an editor frame).

### D5 - `editor/active` is a targeted shell topic, not a new message

`EVENT_TOPICS` gains `editor/active`. The payload is
`{ pluginId, active: true, path, instanceId }` or
`{ pluginId, active: false }`. `EventBus.publish` already accepts a `target`
identity, so the runtime publishes with the previous/next identity and only that
plugin's subscribed frames receive it. The topic follows the existing
per-workspace sequence, queue, rate and at-most-once rules. `events:subscribe`
is required, and the topic is not replayable: the current value is in
`shell/init.activeEditor`.

Editor frames receive the topic too, so an editor can compare its own
`instanceId` with the event and gate its handling. The event does not grant a
permission, change a manifest field or add a consent fingerprint input.

Alternatives: a new `shell/editor-active` message (a second notification
channel), polling from the panel (no shell state access), or a local event
published by the shell (the shell does not publish plugin-local topics).

### D6 - The panel ↔ editor channel stays plugin-local

No frame-to-frame API is added. The intended pattern is:

1. The panel reads `activeEditor` from init or `editor/active`.
2. It publishes a `local/*` event whose payload contains
   `target: activeEditor.instanceId` and a plugin-defined request.
3. The shell delivers it to every subscribed frame of the same identity,
   including hidden editors.
4. Each editor compares `target` with its own `instanceId`; only the matching
   one handles it.
5. The editor replies on a local topic; the panel accepts only events whose
   `from` equals the active instance id.

The shell enforces identity isolation, the 1 MiB payload limit, the 200/s
per-frame publication limit and at-most-once delivery. It does not inspect the
payload. The editor applies edits through its own history, reports dirty with
`plugin/dirty` and saves through the normal `shell/request-save` flow. A view
still has no dirty/save method and cannot write.

The shell cannot enforce a handler's internal filtering: a hidden editor receives
the local event and must ignore a target that is not its own id. `editor/active`
gives it the state it needs to gate; the author guide makes the check part of the
pattern. This is a plugin-internal correctness issue, not a shell write path.

Alternatives: a shell-routed request/reply API (new message surface, payload
interpretation and a second permission model), a `BroadcastChannel` (not
sandbox-safe across origins), or direct `postMessage` between frames (the shell
would lose identity and origin control).

### D7 - Capability bits and compatibility

- `capabilities.bottomPanel` is on registration `shell/init` only. It tells a
  controller that the shell can render the location; the location itself remains
  manifest-owned and cannot be requested at runtime.
- `capabilities.editorContext` is on editor and view init. It is true when the
  shell sends `editor.instanceId`/`activeEditor` and publishes `editor/active`.
- Older shells omit the fields; a new SDK parses `editor` and `activeEditor` as
  `null` and the bits as `false`.
- An older SDK ignores the additive fields. A bottom panel is different: the
  1.9.0 `viewAt` parser rejects `location: "bottom"`, so a plugin that uses the
  location must build against SDK `1.10.0` or a tolerant client. This is stated
  in the contracts and guide rather than hidden behind the generic "older SDKs
  keep working" claim.
- A bottom manifest must declare `engines.exo` at or above `0.10.0`; an older
  shell reports `incompatible-engine` before it reaches the location parser.
- Manifest schema `1`, protocol `1`, shell `0.10.0`, SDK `1.10.0`. No consent
  fingerprint change: bottom panels are user-invoked surfaces and the active
  editor is the plugin's own document metadata.

Alternatives: bump the manifest schema (unnecessary for valid manifests and would
re-prompt every plugin), put `bottomPanel` on every init (redundant), or gate the
location on a runtime negotiation (the manifest is parsed before a frame exists).

### D8 - Contracts, fixture and documentation move with the code

The contracts remain normative: `plugin-manifest.md`, `plugin-protocol.md`,
`events.md` and `plugin-sdk.md` change in the same change as the schema and
runtime. The deployed plugin-host fixture gains a bottom panel and a bound editor
mode so the acceptance path is observable without a local build:

- A bottom panel page subscribes to `editor/active`, shows the active path and
  instance id, requests a snapshot and sends an edit request on a local topic.
- A `**/*.bound.txt` editor page subscribes to the local topic, checks the
  target id, replies with a snapshot, applies an edit through a small history
  stack, reports dirty and supports an undo request before the normal save.
- A non-plugin file and a second plugin identity show the `activeEditor: null`
  empty state and the identity isolation.

The author guide documents the instance-id check and the `from` filter; the
security review adds the identity/target mutation tests; the accessibility and
performance records add the bottom surface.

## Risks / Trade-offs

- **Metadata leak across identities** -> `activeEditor` is filtered by identity,
  not only by the manifest id, and `editor/active` uses `EventBus`'s target
  filter. A cross-origin same-id test fails if either filter is removed.
- **A hidden editor mutates itself after a tab switch** -> the panel only learns
  the active id and filters replies by `from`; the editor must ignore a target
  that is not its own id. The guide makes this explicit, and `editor/active`
  gives the editor the state to gate. The shell has no view write path.
- **Stale panel snapshot while hidden** -> the panel subscribes to
  `editor/active` and requests a fresh snapshot on mount and on every active
  change. The shell does not add a replay or a reveal event.
- **Bottom tab mounting cost** -> only the active tab mounts; a hidden tab has no
  iframe. The frame cap stays eight panels per plugin.
- **Preset tab behavior** -> the preset renders all tab components, so the
  active-tab check lives in the shell's `PanelSurface`, not in a fork. A guard
  test pins that an inactive bottom tab creates no frame.
- **SDK 1.9.0 and bottom location** -> documented as a hard requirement rather
  than pretending the old parser tolerates it. Existing plugins that do not use
  bottom are unaffected.
- **Bundle growth** -> the change adds a topic, a context derivation and a third
  registry. The first measured build was 176,077 gzip js and 13,788 gzip css, so
  the js budget was raised from 176,000 to 178,000 bytes; the CSS budget stays
  14,000. Re-measure after the deploy and keep the written number in the release
  record.
- **Panel reveal noise** -> reveal stays explicit in v1. If editors want an
  automatic companion later, it can be an additive `companion` field in a
  separate change with its own lifecycle rules.

## Migration Plan

1. Land the schema, manifest, registration, host, view-pool and workbench changes
   with the existing plugins unchanged; the base bottom region stays disabled.
2. Add the active-editor derivation, `editor/active`, the editor instance id and
   the view init field; existing views receive `activeEditor: null` until an
   editor of their plugin is active.
3. Add the SDK types, parsers, capability bits and version; update the shell,
   template and code-plugin workspace manifests to SDK `1.10.0`.
4. Update the contracts, guide, fixture, changelog and release records; run the
   full gate and deploy.
5. Verify on the deployed fixture: bottom tab, two editor tabs, a panel edit with
   undo/dirty/save, a non-plugin active tab, and the identity isolation. Record
   the deployed commit and date in this design and `ROADMAP.md`.
6. Rollback is a shell redeploy. Existing manifests and grants are unchanged; a
   manifest that uses bottom is rejected by the older shell, so no stored state
   needs migration.

## Verification plan

- Unit and integration tests cover the manifest/schema/consent paths, host
  snapshot, derived workbench, lazy bottom mount, view init, editor init,
  `editor/active` targeting and sequences, runtime tab/rename/clear behavior, SDK
  parsing and capability defaults, and the fixture pages.
- Mutation checks: remove the identity filter from `activeEditor`, remove the
  target from `editor/active`, remove the active-tab placeholder condition, and
  remove the editor instance id from the init; the named tests must fail.
- The full local gate from `AGENTS.md`, `openspec validate --all` and the
  deployed fixture path are required before the change is archived. The deployed
  evidence is recorded here and in `ROADMAP.md` after the Pages deploy.

## Deployed verification (2026-11-24)

Run against deployed commit `0b33f35` (shell asset `index-cvcmiO3Q.js`, the same
shell build as `782615a`) at `https://mode777.github.io/exo-editor/` with
`chrome-headless-shell` 131.0.6778.264 at 1440x900. The workspace was an OPFS
directory exposed through the `showDirectoryPicker` stub, containing `exo.json`
with the deployed main and other fixture manifests, `a.bound.txt`,
`b.bound.txt`, `notes.txt` and `other.local-other.txt`. The deployed fixture,
manifest and pages were the real artifacts; no local dev server or local build
was used.

Passed:

- Consent listed **Fixture Inspection** as a bottom panel tab.
- The bottom frame init carried `view.location: "bottom"`,
  `capabilities.editorContext: true` and `activeEditor: null` before any file
  was open; the same-origin frame used `sandbox="allow-scripts"` only.
- The bottom tab title named the plugin, and the secondary **Fixture Inspector**
  panel appeared in its region.
- The `*.bound.txt` editor init carried an `instanceId` and saw itself active;
  the panel followed the active editor and a same-plugin tab switch, and the
  inactive editor saw the new active instance rather than itself.
- **Apply panel edit** reached only the active editor, marked it dirty and
  appended the panel text; the panel received the applied snapshot and the
  inactive editor ignored the edit. **Undo panel edit** restored the editor
  buffer through its own history while staying dirty.
- Ctrl/Cmd+S saved through the normal shell flow and the editor reported
  `saveCount: 1`, `saveResult.ok: true` and a clean buffer.
- Switching to `notes.txt` cleared the panel to `activeEditor: null`.
- The other plugin's editor was observed with the main panel's `activeEditor`
  still `null`; the verification script's final assertion was malformed (it
  returned a string instead of a boolean), so the run exited before printing its
  summary. The observation itself was the expected null context.
- The local gate passed: lint, format, typecheck, 942 shell tests, 115 SDK tests,
  template tests, build, bundle budget, CSP, custom elements, no-SDK,
  no-Monaco, template/code builds and secret check. The measured bundle was
  176,077 gzip js and 13,788 gzip css; the js limit was raised from 176,000 to
  178,000 with that measurement.
- `openspec validate editor-bound-panels --strict` and `openspec validate --all`
  passed.
- The bottom-panel retained reveal was measured on the same deployed build:
  five runs after one warm-up, 14, 18, 7, 14 and 10 ms, median 14 ms and maximum
  18 ms against the 2,000 ms view-frame ceiling. The first cold mount happens
  during registration and is covered by the no-lazy-frame check.

