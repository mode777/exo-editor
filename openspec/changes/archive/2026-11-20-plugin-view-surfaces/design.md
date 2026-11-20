# Design

## Context

See `proposal.md` for motivation. The current shell composition is static:
`workbenchConfig` and `workbenchViews` are module constants, the explorer is the
only primary view, and the secondary side bar is disabled. `VSCodeWorkbench`
accepts `config` and `views` as props, and the preset's `ActivityBar` calls
`togglePrimarySideBar(itemId)`, so a primary view id doubles as its activity item
id. The preset has no secondary-view switcher, and its `WorkbenchTab.kind` is the
closed union `'welcome' | 'file' | 'readme' | 'untitled'`.

`DomFrameTransport` already creates a visible iframe in a fixed overlay and
positions it over a shell-owned element's bounding rect, with a `ResizeObserver`
that follows sidebar and pane resizing. `HandlerPool.attachSurface` is the only
consumer today. `HandlerSession` owns the read/list/picker/events path and the
editor-only dirty/save path in one large class. `PluginHost` owns the
registration frame, the manifest snapshot and the editor registry.

`plugin-local-events` adds the `local/` event namespace and moves bus ownership
to the runtime. This change assumes that change has landed, so view frames can
use the same bus and the same identity scope.

## Goals / Non-Goals

**Goals:**

- Add panels and content views without forking the workbench preset.
- Reuse the frame transport, read path, event bus and consent model.
- Keep panels stateful across view switches while mounting them lazily.
- Make content views read-only tabs with a one-shot, bounded payload.
- Let any active frame navigate and control only its own plugin's panels.
- Keep the new surfaces out of the consent fingerprint while naming the plugin
  in shell chrome.

**Non-Goals:**

- Content-view editing or saving; file creation is its own change.
- Arbitrary top-level iframe URLs or external navigations.
- Generic plugin command execution or plugin-defined panel header actions.
- Multiple views behind one activity icon or a view container model.
- Cross-plugin local events; the only cross-plugin channel is the one-shot
  `open-view` payload.
- A second view switcher for primary panels; the activity bar already is one.

## Decisions

### D1 - One `view` mode for panels and content views

Panels and content views share `exo-mode=view`, the same handshake, the same
sandbox, the same read/list/picker/events path and the same dispose flow. They
differ only in the `view.kind` and lifecycle: a panel is a singleton that lives
with the plugin, a content view is one instance per open tab. A second mode would
duplicate the security-critical handshake and read path for no benefit.

Alternatives: a `panel` mode and a `content` mode (two copies of the same
session), or reusing `editor` with a synthetic file (would give the frame a file
block it must not have and invite save behavior that does not exist).

### D2 - Declare in the manifest, register in the controller, mount lazily

The manifest declares the panel/content-view metadata that consent displays and
the host validates. The controller registers the ids it wants active, exactly as
it does for file editors. Registration creates the activity item or palette
entry but no iframe. A panel frame is created on its first reveal and retained
hidden afterwards; a content-view frame is created when its tab opens.

Lazy mounting keeps a plugin with four panels and no open documents at zero
frames. Retaining a revealed panel keeps its state and its local-event
subscription alive, which is what makes it a usable hub for content views.

### D3 - Extract the shared read path, add a view pool

`HandlerSession` currently combines the handshake, the mediated read path, the
file picker, events and the editor-only dirty/save flow. A `ViewSession` needs
the first four and must not duplicate the path, reserved-path or size checks.
Extract a base session with the gate, read/list/picker/events and dispose state;
`HandlerSession` adds file metadata, dirty and save; `ViewSession` adds the view
block and the navigation/panel intents.

The new `ViewPool` mirrors `HandlerPool`: it owns panel and content frames,
surface attachment, the per-plugin frame count and teardown order. Both pools
share the runtime-owned `EventBus`; neither resets it. A plugin's total frame
budget is the sum of handler and view frames, with separate caps per kind.

### D4 - Primary panels use the activity bar; secondary panels use a shell picker

The preset `ActivityBar` hardcodes `togglePrimarySideBar(itemId)`. A primary
panel therefore needs a unique view id, an activity item with the same id, and an
entry in `primarySideBar.views`; the shell derives all three from the host
snapshot. The explorer stays first.

The preset has no secondary switcher and no way to bind an activity item to the
secondary region. A secondary panel gets a shell-owned "Show View" palette entry
and a synthetic "Select View" header action on every secondary view. That is a
smaller change than replacing the preset activity bar with a custom composition
and losing its active-state behavior.

Alternatives: a custom `ActivityBar` composition (larger, no preset store
compatibility), one secondary view only (no switching), or putting secondary
panels in the bottom panel (wrong placement).

### D5 - Content views are read-only tabs with a contained tab-kind adapter

A content view has no file path and no dirty/save flow. It opens a normal
workbench tab whose id is `content:<identity>:<viewId>:<instanceKey>` and whose
title is the manifest title. `renderDocument` resolves the tab id through the
shell's content-view registry and renders a surface placeholder. `activeDocumentPath()`
returns null, Save is unavailable and the close guard ignores the tab.

The kit's `TabKind` union is closed in `0.1.3`. The tab is created through one
adapter that marks it as a content tab and casts at the store boundary; a guard
test pins that the kit does not branch on the unknown kind for rendering. The
clean long-term fix is an upstream `TabKind` widening, which is not a prerequisite.

### D6 - Payloads, instances and cross-plugin opens

`open-view` accepts `{ pluginId?, viewId, instanceKey?, payload? }`. Without
`pluginId` the shell searches the caller's own plugin. With it, the shell resolves
the active plugin with that id; duplicate identities are already resolved to the
earlier `exo.json` entry, so the lookup is deterministic.

`instanceKey` is the deduplication key: the tab id includes it, and the existing
`openTab` behavior focuses an existing tab instead of adding a second one. The
new payload is ignored on an existing instance.

The payload is JSON, capped at 64 KiB, passed only in `shell/init`, never in the
URL fragment and never logged. A cross-plugin open adds
`view.openedBy = { pluginId, pluginName, origin }`; the target treats the payload
as untrusted data and `openedBy` as advisory display information. There is no
reverse channel: the opener gets an `open-result`, not the target's state or
events, and local topics stay scoped by identity.

Alternatives: restrict cross-plugin opens (the user asked to allow them),
address instances directly for local events (would create a cross-plugin
channel), or send the payload in the fragment (size, logging and cache issues).

### D7 - Navigation and panel intents are correlated and gated

`plugin/open-file`, `plugin/open-view` and `plugin/request-panel` are available
in both editor and view phases. Each carries an id and gets `shell/open-result`
or `shell/panel-result`, or a `shell/error` with `replyTo`. The shell checks, in
order:

1. the session is active and not disposing;
2. the frame is currently visible and active (the document tab is active or the
   panel is the shown view);
3. `workspace:read` for `open-file`; no extra permission for `open-view` or
   `request-panel`;
4. the per-frame intent budget (ten per rolling second);
5. for `open-file`: normalization, containment, reserved-path rejection,
   existence and file kind;
6. for `open-view`: the target plugin and registered view id;
7. for `request-panel`: the caller's own registered panel id.

A hidden frame is denied so a background tab cannot navigate the workspace or
change the layout. `open-file` from an editor resolves relative paths against
the document; a view has no base, so its path must be `/`-rooted.

### D8 - No consent fingerprint change, but plugin identity in chrome

Panels, content views and the intents are user-invoked surfaces inside the
already-approved root or user-mediated navigation. They do not grant autonomous
data access, so they are excluded from the fingerprint and an existing grant is
not re-prompted. The first-grant prompt lists them; the shell names the plugin in
the activity-bar tooltip, secondary picker and content-view chrome.

This is a deliberate narrowing of the "new capability field re-prompts" rule.
The security review records it as an accepted risk with the chrome-naming
mitigation. A plugin can add an activity icon or content view without a new
prompt, but it cannot read a file or open a tab without the user's action.

### D9 - Frame caps and surface lifecycle

- Panels: at most 8 declared per plugin; one frame per registered panel; mounted
  lazily; retained; disposed on plugin stop or workspace switch.
- Content views: at most 16 declared and 10 open tabs per plugin; one frame per
  open tab; disposed on tab close.
- The activity bar falls back to the explorer when the active primary panel is
  gone; the secondary region hides when no secondary panel remains.
- A panel failure keeps its activity item and shows an inline retry; a content
  view failure shows retry and close in its tab.
- Content-view tabs are closed without a dirty prompt; they are never dirty.

### D10 - SDK surface

`connectBrowserPlugin` gains a `view` branch with a `ViewClient` that shares the
read/list/picker/event base with `EditorClient`. `RegistrationClient` gains
`registerPanel(id)` and `registerContentView(id)`. Both clients gain
`openFile`, `openView` and `requestPanel`. The helpers preflight the support bit,
the permission and the 64 KiB payload limit, and map absence of a support bit to
`unsupported-message`. SDK `1.5.0`, protocol major `1`.

## Risks / Trade-offs

- **Silent surface additions** -> the fingerprint stays unchanged by design.
  Mitigation: first-grant listing, plugin name in every view chrome and the
  security review's accepted-risk entry. If this proves too weak, adding the
  arrays to the fingerprint is a one-change follow-up with a single re-prompt.
- **Cross-plugin payload spoofing** -> the target receives `openedBy` from the
  shell, not the caller, and must treat the payload as untrusted. No reverse
  channel means a malicious opener cannot read the target or observe its state.
- **Preset limitation on secondary views** -> the header picker and palette are
  shell-owned; no preset fork. The cost is one extra click compared with an
  activity icon.
- **Closed `TabKind` union** -> one contained adapter and a guard test. If the
  upstream package later widens the type, the adapter can be deleted.
- **Frame memory and hidden work** -> lazy mount, per-kind caps, and a per-plugin
  total. A retained panel can do background work while hidden; that is the
  documented consequence of a stateful hub.
- **Session-base refactor regressions** -> the existing handler conformance,
  read, picker and event tests must pass unchanged before the view path is added.
- **Intent spam** -> ten requests per second per frame, the content-view cap and
  the plugin-initiated tab cap. Excess is `rate-limited`, not a teardown.
- **Bus reset race** -> the runtime owns the only reset; the view and handler
  pools never reset each other's subscriptions.

## Migration Plan

1. Land `plugin-local-events` first: shell `0.2.0`, SDK `1.4.0`, protocol `1`.
2. Land this change: shell `0.3.0`, SDK `1.5.0`, manifest schema stays `1`. A
   manifest with the new contribution fields must declare an `engines.exo` range
   that includes `0.3.0`.
3. Existing plugins and grants are unchanged. No storage migration, no persisted
   view state and no tab persistence. A rollback is a shell redeploy; plugins
   that use the new surfaces fall back when the support bits are absent.
4. Verify the deployed shell with the reference fixture: primary panel, secondary
   panel, content view with a payload, cross-plugin open, and a hidden-frame
   denied intent.

## Deployed verification (2026-11-20)

Run against deployed commit `3f69504` (asset `index-BotyjZ52.js`) at
`https://mode777.github.io/exo-editor/` with Chrome for Testing 131.0.6778.264,
using an OPFS workspace mounted through a `showDirectoryPicker` stub and the
deployed plugin-host fixture plus its second identity. The deployed shell,
fixture pages and manifests were the real artifacts; no local dev server or
local build was used.

- Consent listed both panels and the content view as a read-only tab.
- A panel created no iframe before its first reveal. On reveal it received
  `mode: "view"`, a `view` block (`kind: "panel"`, id, title, location,
  instanceId) and the intent/local-event support bits, with no file block. It
  used `sandbox="allow-scripts"`, sat within 4 px of its placeholder and reused
  the same frame session when hidden and re-shown.
- `plugin/request-panel` returned `{ panel: "fixture-inspector", open: true }`
  and made the secondary region visible. The "Select View" action listed both
  secondary panels with their plugin names; focus entered the first option,
  Arrow Down moved to the second and Escape closed the picker.
- A same-plugin content view received `kind: "content"`, its 64 KiB payload and
  `openedBy` with the opener plugin id, name and origin. The tab named the plugin
  and had no shell text editor. The content frame opened `/notes.txt` and then
  reused its session across a tab switch. While its tab was hidden, the same
  intent was denied with `permission-denied` and opened no tab.
- A cross-plugin content view opened the second plugin's `other-tutorial`,
  received `openedBy` from the opener, received no local event from the opener
  and had no reverse channel.
- A 64 KiB payload string (131,072 bytes by the shell's size rule) returned
  `too-large` with `Content-view payloads are limited to 65536 bytes.` and opened
  no tab.
- The command palette listed `Open Fixture Tutorial` and opened it with no
  payload and a fresh instance key.
- Closing a content tab removed its frame. Disabling the plugin removed its
  activity item, panel/content frames and content tabs, and the plugin log kept
  the view phases. Switching to a second workspace cleared the tabs and mounted
  the new workspace.
- No page error was recorded. Thirty-two view checks and nine teardown checks
  passed.

View startup measured on the same deployed shell: panel reveal median 28 / max
140 ms and content-view open median 471 / max 494 ms against the 2,000 ms
ceiling recorded in `docs/performance.md`.

The local gate passed: 801 shell tests, 78 SDK tests, typecheck, lint, format,
build, bundle budget 165,357/167,000 js and 13,391/14,000 css gzip bytes, CSP,
custom elements, no-SDK, no-Monaco, the template and code-plugin builds,
secret scan and `openspec validate --all`.
