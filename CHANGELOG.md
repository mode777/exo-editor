# Changelog

All notable changes to Exo Editor are recorded here. The version axes and the
release process are in [`docs/releases.md`](./docs/releases.md).

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
