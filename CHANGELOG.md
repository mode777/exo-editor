# Changelog

All notable changes to Exo Editor are recorded here. The version axes and the
release process are in [`docs/releases.md`](./docs/releases.md).

## [0.11.0] - 2026-11-27

Additive post-release update: surface companion panels.

### Added

- `contributes.fileEditors[].companionPanels` and
  `contributes.contentViews[].companionPanels` accept one to three panel ids.
  A contribution may bind at most one panel per `primary`, `secondary` and
  `bottom` location, and a panel may be shared by several contributions.
- The shell reveals a content view's companions when the view opens or its tab
  is active, and a file editor's companions only after its tab is active and its
  handler has completed the handshake. It hides each companion when the active
  surface does not declare it, when the handler clears or the last content view
  closes, and keeps panels shared by the old and new surface visible.
- `companionPanel` remains a one-panel compatibility alias on content views; it
  cannot be combined with `companionPanels`. The shell normalizes both forms.
- The deployed fixture adds **Fixture Gallery** with companions in all three
  regions and a `**/*.companion.txt` editor with its own three companions.
- A manifest that uses `companionPanels` or binds a companion to a primary or
  bottom panel must declare `engines.exo` at or above `0.11.0`.

### Compatibility

- Shell: `0.11.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.10.0`

### Breaking

- None for existing plugins. `companionPanel` on a secondary content-view panel
  keeps its behavior, and older shells report `incompatible-engine` for a
  manifest that uses the new field or location. No protocol message, shell event,
  SDK API or consent fingerprint input changes.

## [0.10.0] - 2026-11-24

Additive post-release update: editor-bound panels and a bottom panel location.

### Added

- `contributes.panels` accepts `location: "bottom"`. Registered bottom panels
  appear as tabs in the shell bottom region; only the active tab mounts a frame,
  and multiple bottom panels share the region. The panel limit stays eight
  across all locations. A manifest that uses the location must declare
  `engines.exo` at or above `0.10.0`.
- A view frame's `shell/init` now carries `activeEditor` with
  `{ pluginId, path, instanceId }` or `null`, limited to the same plugin
  identity. The shell catalog adds the targeted `editor/active` topic with
  `{ pluginId, active: true, path, instanceId }` or `{ pluginId, active: false }`.
- An editor frame's `shell/init` carries `editor.instanceId`, the same opaque id
  used in `activeEditor`, `editor/active` and the local-event `from`. Editor and
  view init add `capabilities.editorContext`; registration init adds
  `capabilities.bottomPanel`.
- SDK `1.10.0` exposes `view.activeEditor`, `EditorClient.instanceId`, the
  `editor/active` topic and the new capability bits, and accepts the `bottom`
  view location.
- Panels can follow the active editor through the existing `local/*` events:
  publish a payload containing the target instance id, handle only the matching
  editor, and accept a reply only when `from` matches. The editor keeps the
  document, history, dirty state and save flow; a view still has no save path.

### Compatibility

- Shell: `0.10.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.10.0`

### Breaking

- None for existing plugins. An older shell reports `incompatible-engine` for a
  manifest that uses the bottom location, and an older SDK rejects the unknown
  `view.location`; a plugin that declares a bottom panel must build against SDK
  `1.10.0` (or a client that accepts the location). The active-editor fields are
  additive: an older shell omits them and a new SDK reports `null`/`false`.

## [0.9.0] - 2026-11-24

Additive post-release update: active content-view context for panels.

### Added

- `shell/init` for a view now carries `activeContentView` with the active
  content view's `pluginId`, `viewId`, `instanceId` and `instanceKey`, or `null`
  when another surface or no tab is active. The value is limited to the frame's
  own plugin and evaluated when the handshake is sent.
- The shell catalog adds the targeted `view/active` topic. It publishes
  `{ pluginId, active: true, viewId, instanceId, instanceKey }` when a plugin's
  active content-view tab changes, and `{ pluginId, active: false }` when no
  content view of that plugin is active. Only that plugin's subscribed frames
  receive it.
- SDK `1.9.0` exposes `view.activeContentView` and types the new topic. A plugin
  can keep a panel bound to the active content-view instance without inferring
  tab state from iframe visibility or polling.

### Compatibility

- Shell: `0.9.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.9.0`

### Breaking

- None. Older shells omit the init field and reject the topic; SDK `1.9.0`
  reports `activeContentView` as `null` and leaves the subscription error to the
  shell's normal reply.

## [0.8.3] - 2026-11-24

Additive shell behavior: a content-view companion follows the active tab.

### Added

- The shell now reveals a content view's declared companion when its tab becomes
  the active tab and hides it when the active tab moves to a file or a content
  view with a different (or no) companion. A companion shared by several open
  preview tabs stays visible while any matching tab is active; switching between
  them does not hide it. Manual hide and a user-selected other secondary panel
  keep their existing rules.

### Compatibility

- Shell: `0.8.3`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.8.0`

### Breaking

- None. No message, manifest field, permission, capability, consent fingerprint
  input or SDK API changes.

## [0.8.2] - 2026-11-24

Bug-fix shell release: switching content-view tabs reattaches the active frame.

### Fixed

- Switching directly between two content-view tabs now remounts the shell-owned
  content surface. The previous instance's frame is hidden and the newly active
  instance's frame is shown. Previously the reused surface kept the first
  frame attached, so a second content-view tab opened but stayed hidden, which
  prevented plugins from showing more than one content-view instance.
- The surface keeps its per-instance placeholder, frame attachment and
  companion reveal behavior; tab close, reuse of an existing instance key and
  file tabs are unchanged.

### Compatibility

- Shell: `0.8.2`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.8.0`

### Breaking

- None. No message, manifest field, permission, capability, consent fingerprint
  input or SDK API changes.

## [0.8.1] - 2026-11-24

Bug-fix shell release: sash drags stay with the shell across plugin frames.

### Fixed

- Dragging the secondary side-bar sash no longer freezes, jumps or keeps
  resizing after the mouse button is released when the pointer crosses a visible
  plugin frame. The sash now paints above plugin surfaces and captures the
  pointer for the rest of the drag, so the shell keeps receiving pointer moves
  and the release. The primary side bar and bottom panel use the same capture
  path.
- The full 7px secondary side-bar sash now starts a drag; the plugin overlay no
  longer covers its right half.

### Compatibility

- Shell: `0.8.1`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.8.0`

### Breaking

- None. No message, manifest field, permission, capability, consent fingerprint
  input or SDK API changes.

## [0.8.0] - 2026-11-23

Additive post-release update: command-scoped user activation for file dialogs.

### Added

- A live plugin command invocation now treats its exact target frame as
  user-activated for `plugin/request-new-file` and `plugin/request-files`, even
  when the frame does not own DOM focus. A panel or content-view command can
  therefore create a file or open the workspace picker from its `shell/command`
  handler without stealing focus.
- The grant begins before command delivery and ends when the invocation settles,
  times out, the frame is disposed, the plugin stops or the workspace switches.
  It applies only to the target frame/session, never focuses the frame, and
  never authorizes a request after the result or timeout.

### Changed

- Shell `0.8.0` relaxes the focus gate only inside a live command invocation.
  All existing permissions, capabilities, visibility, size, rate, create-only
  and shell-owned dialog rules remain unchanged. The Tenon plugin can drop its
  fixed `newFiles` template workaround and create content from its panel-target
  command.

### Compatibility

- Shell: `0.8.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.8.0`

### Breaking

- None. This is additive shell behavior within protocol major `1` and manifest
  schema `1`. No permission, message, manifest field, capability bit or consent
  fingerprint input is added, and the SDK API is unchanged. An older shell still
  denies the request and a plugin can keep its `newFiles` fallback.

## [0.7.0] - 2026-11-22

Additive post-release update: plugin styling and the SDK theme surface.

### Added

- `@exo/plugin-sdk/theme` with `applyTheme(theme, options?)` and
  `followTheme(client, options?)`. The helper writes the shell theme name to
  `data-theme`, applies `shell/init.theme`, follows `theme/changed` when the
  manifest has `events:subscribe`, and returns a listener cleanup.
- `@exo/plugin-sdk/theme.css`, an optional semantic token sheet with complete
  dark, light and high-contrast palettes, `color-scheme` for native controls and
  a `prefers-color-scheme` fallback for the interval before the handshake.
- `docs/contracts/plugin-styling.md`, the author-guide styling page, and a
  styling step in the `create-exo-plugin` skill covering both themes, high
  contrast, editor-library theme mapping, contrast, focus and reduced motion.
- The reference code plugin now imports the SDK token sheet and uses
  `followTheme` for its initial and live theme, while Monaco keeps its own
  `vs`/`vs-dark`/`hc-black` mapping.
- Shell `0.7.0` records the deployed documentation and SDK addition; the shell
  runtime surface is unchanged.

### Compatibility

- Shell: `0.7.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.8.0`

### Breaking

- None. The theme helper, stylesheet and guide are additive within protocol
  major `1` and manifest schema `1`. No permission, message, manifest field or
  consent fingerprint input is added. A plugin that does not import the theme
  surface keeps its current appearance and behavior.

## [0.6.0] - 2026-11-22

Additive post-release update: declarative content-view companion panels.

### Added

- Optional `contributes.contentViews[].companionPanel` naming a panel declared
  in the same manifest with `location: "secondary"`. An unknown id, a primary
  panel or an invalid id fails manifest validation, and the association is
  preserved on the registered content view and host snapshot.
- Shell-owned reveal and hide behavior: opening or focusing a content view shows
  its companion in the secondary side bar; closing the last open instance that
  shares it hides the panel. A manually hidden panel stays hidden until the next
  open or focus, a user-selected other secondary view is left alone, and an
  unregistered companion is skipped without blocking the content view.
- Companion visibility is derived from the open view records in every teardown
  path (`closeContent`, `closeFor`, `disposeAll`, plugin removal and workspace
  switch); there is no refcount, heartbeat, polling or new plugin lifecycle
  event. `plugin/request-panel` keeps its existing semantics.
- Shell `0.6.0`. No new permission, consent fingerprint input, protocol message,
  SDK API or manifest schema version is added.

### Compatibility

- Shell: `0.6.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.7.0`

### Breaking

- None. The field is optional within manifest schema `1`, the protocol and SDK
  are unchanged, and existing plugins behave as before. A plugin that adopts
  `companionPanel` must declare an `engines.exo` range that includes `0.6.0`;
  an older shell rejects the unknown field and reports `incompatible-engine`
  before mounting a partial surface.

## [0.5.0] - 2026-11-20

Additive post-release update: plugin new-file creation and manifest templates.

### Added

- `contributes.newFiles` (at most 20) with `id`, `label`, `fileName`, optional
  `encoding` (`utf8` or `base64`) and `content`, capped at 64 KiB per decoded
  template and 128 KiB per plugin. Names are one segment and never `exo.json` or
  `.exo`.
- `plugin/register.newFiles` and additive `acceptedNewFiles` in
  `shell/register-ack`. A template activates only after
  `plugin/register-complete` and requires `workspace:write`.
- The correlated `plugin/request-new-file` / `shell/new-file-result` flow with an
  optional suggested name and directory hint, the shell-owned Save As dialog, a
  bounded text preview or binary label, and an 8 MiB generated-file cap.
- `WriteOptions.createOnly` in the workspace contract. The memory provider checks
  and writes atomically; the folder and Stratofold providers pre-check and
  document the residual check-to-write race because neither exposes a
  target-absent conditional create.
- Explorer New File templates grouped by plugin, palette entries per template,
  and the shell-owned Save As dialog. A runtime-created file is not opened
  automatically; a template-created file opens because the user chose it.
- `capabilities.createFile` in editor and view init and
  `capabilities.newFiles` in registration init; absence means an older shell.
- `@exo/plugin-sdk` `1.7.0` with `requestNewFile()` on editor and view clients
  and `registerNewFile()` on the registration client.
- Templates are listed in the first-grant consent prompt and deliberately
  excluded from the consent fingerprint.

### Compatibility

- Shell: `0.5.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.7.0`

### Breaking

- None. The manifest field, registration field, messages, capability and SDK
  helpers are additive within protocol major `1`. A plugin that adopts the field
  must declare an `engines.exo` range that includes `0.5.0`; an older shell
  reports `incompatible-engine` rather than mounting a partial surface. Existing
  Empty File creation now refuses an existing name instead of silently
  overwriting it.

## [0.4.0] - 2026-11-20

Additive post-release update: plugin commands in shell-owned surfaces.

### Added

- `contributes.commands` (at most 32) with `id`, `title`, optional `category`,
  a target (`activeEditor`, a declared panel or a declared content view) and
  optional `menus` (`commandPalette`, `explorer/context`, `editor/title`).
  `editor/title` requires an `activeEditor` target and `explorer/context`
  requires a panel or content-view target.
- `plugin/register.commands`, additive `acceptedCommands` in
  `shell/register-ack`, and `target-not-registered` at
  `plugin/register-complete` when a command's view target was not registered in
  the same session.
- `shell/command` and `plugin/command-result`, with shell-derived
  `{ path, kind }` arguments for explorer invocations, a ten-second result
  timeout, one in-flight invocation per command, five concurrent invocations per
  plugin, a five-second cooldown and a 200-character plain-text failure notice.
- Shell-owned palette entries with synthetic ids, explorer context entries and
  an editor action row, all attributed to the plugin by name.
- `capabilities.commands` in editor and view init; absence means an older shell.
- `@exo/plugin-sdk` `1.6.0` with `registerCommand()`, `onCommand()` on editor and
  view clients, the ten-message early queue and automatic success and failure
  results.
- Commands are listed in the first-grant consent prompt and are deliberately
  excluded from the consent fingerprint.

### Compatibility

- Shell: `0.4.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.6.0`

### Breaking

- None. The manifest field, registration field, messages, capability and SDK
  helpers are additive within protocol major `1`. A plugin that adopts the field
  must declare an `engines.exo` range that includes `0.4.0`; an older shell
  reports `incompatible-engine` rather than mounting a partial surface.

## [0.3.0] - 2026-11-20

Additive post-release update: plugin panels, content views and navigation intents.

### Added

- `contributes.panels` (at most 8) for primary and secondary side-bar panels and
  `contributes.contentViews` (at most 16) for read-only content tabs. Panels mount
  lazily on first reveal and are retained hidden; content views open one frame per
  tab instance with an optional 64 KiB JSON payload and `openedBy`.
- The `view` frame mode and `shell/init.view`, sharing the handshake, sandbox,
  read/list/picker/event path and disposal with editor frames. View frames have no
  file block, dirty state or save path.
- `plugin/open-file`, `plugin/open-view` and `plugin/request-panel`, with the
  correlated `shell/open-result` and `shell/panel-result`, active/visible gating,
  reserved-path checks, the 50 plugin-opened file tab cap and ten intents per
  rolling second per frame.
- `capabilities.openFile`, `capabilities.openView` and
  `capabilities.requestPanel` in editor and view init; absence means an older
  shell.
- Primary panels add activity-bar items and left-side-bar views; secondary panels
  are reached through the shell's Select View picker and palette entries. The
  shell names the plugin in activity titles, the picker and content-view chrome.
- `@exo/plugin-sdk` `1.5.0` with `ViewClient`, `registerPanel()`,
  `registerContentView()`, `openFile()`, `openView()` and `requestPanel()`.
- Panels and content views are displayed in the first-grant consent prompt and are
  deliberately excluded from the consent fingerprint.

### Compatibility

- Shell: `0.3.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.5.0`

### Breaking

- None. The mode, init block, registration fields and messages are additive
  within protocol major `1`. A plugin that adopts the new contribution fields must
  declare an `engines.exo` range that includes `0.3.0`; an older shell reports
  `incompatible-engine` rather than mounting a partial surface.

## [0.2.0] - 2026-11-20

Additive post-release update: plugin-local events between the frames of one
plugin.

### Added

- `plugin/publish` / `shell/published` and the reserved `local/<name>` topic
  namespace. Local events are scoped to one plugin identity, carry the
  publishing frame's opaque `from` session id, and never route to another
  plugin.
- `capabilities.localEvents` in editor and registration `shell/init`; `1.4.0`
  of `@exo/plugin-sdk` adds `publishLocal()`, `subscribeLocal()`,
  `onLocalEvent()` and the absent-as-false support bit.
- Limits: 1 MiB per local payload, 100 events/s per identity and topic, 200
  events/s per frame across local topics, and the existing 32-topic and
  1,000-event queue budgets shared with shell topics.
- The event bus is owned by the workspace runtime and shared with the handler
  pool, so a pool attach or detach no longer resets another pool's
  subscriptions.

### Compatibility

- Shell: `0.2.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.4.0`

### Breaking

- None. The messages, capability and SDK helpers are additive within protocol
  major `1`; `events:subscribe` keeps its existing permission string and stored
  consent.

## [0.1.0] - 2026-11-18

Additive post-release updates: the plugin file picker and directory listing.

### Added

- The explorer shows the active workspace's name in a header row with New File,
  New Folder, Refresh Explorer and Collapse Folders in Explorer actions, expands
  and collapses folders on a single click, and offers `exo.explorer.collapseAll`
  in the View menu and command palette.
- `plugin/request-files` / `shell/files-selected` and the shell-owned workspace
  picker for active visible plugin handlers; paths only, no content or handles.
- `plugin/request-list` / `shell/list-result`, the `workspace:list` manifest
  permission and the `capabilities.directoryListing` support bit: one directory
  level, 1,000-entry snapshot pages with an opaque cursor and minimal
  path/kind/size entries.
- `@exo/plugin-sdk` `1.3.0` with `EditorClient.listDirectory()` and the
  `capabilities.directoryListing` support bit. `1.2.0` added
  `EditorClient.requestFiles()`.

### Compatibility

- Shell: `0.1.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.3.0`

### Breaking

- None. The messages, permission and capability are additive within protocol
  major `1`; existing manifests keep their consent until they add
  `workspace:list`.

## [0.1.0] - 2026-11-16

First public v1 release. The shell is deployed at
`https://mode777.github.io/exo-editor/`; editors are untrusted sandboxed plugins.

### Added

- The static workbench shell, workspace providers (folder and Stratofold
  remote), consent, plugin host, file handlers, events and plugin settings.
- `@exo/plugin-sdk` (private), the starter template and the Monaco reference
  code plugin, deployed as child paths of the shell site.
- The release evidence and author handoff: security review, accessibility,
  browser matrix, performance budgets, plugin author guide, demo workspace and
  walkthrough.

### Compatibility

- Shell: `0.1.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.1.0`

### Breaking

- None. This is the first release of protocol major `1`.
