# Plugin host fixture

A dependency-free stub plugin used to verify the plugin host and the file-editor
layer. It is copied into the deployed shell at
`/exo-editor/plugin-host-fixture/` and can also be served on a second origin for
cross-origin checks.

## Serve on a second origin

```bash
npm run dev:plugin
```

This serves `http://localhost:5174/` with `Access-Control-Allow-Origin: *` and
`application/json` for manifests. Use these manifest URLs in `exo.json`:

| Purpose                      | URL                                               |
| ---------------------------- | ------------------------------------------------- |
| Normal registration          | `http://localhost:5174/exo-manifest.json`         |
| Missing CORS                 | `http://localhost:5174/no-cors/exo-manifest.json` |
| Never sends `ready`          | `http://localhost:5174/never-ready-manifest.json` |
| Widened capabilities         | `http://localhost:5174/widened-manifest.json`     |
| Duplicate identity           | `http://localhost:5174/duplicate-manifest.json`   |
| Second local-events identity | `http://localhost:5174/other-manifest.json`       |

The deployed same-origin copy lives at
`https://mode777.github.io/exo-editor/plugin-host-fixture/exo-manifest.json`.
`readonly-manifest.json` declares the same editors with only `workspace:read`, so
a save must not be offered. It also declares the same contributed settings
without `events:subscribe`, which makes the no-live-update hint observable.

## Controller observations

`plugin.html` writes `{ mode, origin, storage }` to `#observation` and sets a
title such as `Exo fixture register available`. `storage` is `unavailable` when
the sandbox denies `localStorage`; that is expected for a same-origin plugin
mounted with `allow-scripts` only, and `available` for a cross-origin plugin with
`allow-scripts allow-same-origin`.

The controller registers every declared editor glob with its page. The
`**/*.sibling.txt` contribution maps to `sibling.html`, which is inside the
plugin root but deliberately implements no handler protocol, so the
"page inside the approved root" rule and the ready timeout are observable
without breaking the other variants.

## File editors

`editor-common.js` is the shared handler. Each page selects a mode with
`window.EXO_FIXTURE_MODE`, performs the handshake, requests the file, reports
`plugin/dirty`, answers `shell/request-save` with the loaded text plus a marker,
and acknowledges `shell/dispose`. State is mirrored into `#observation` and the
document title so a hidden frame remains inspectable in devtools.

| File glob           | Page                       | Behaviour                                                                                                                                          |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**/*.bound.txt`    | `editor-bound.html`        | Subscribes to `editor/active` and `local/fixture`; answers panel snapshots, applies edits with history and undo, and saves through the normal flow |
| `**/*.local.txt`    | `editor-local-events.html` | Visible frame with a Publish button; subscribes to `local/fixture` and records acknowledgements and received events                                |
| `**/*.list.txt`     | `editor-list.html`         | Probes `plugin/request-list`: root, relative, large, file, missing and reserved                                                                    |
| `**/*.picker.txt`   | `editor-picker.html`       | Visible frame with a Pick button; exercises `plugin/request-files`                                                                                 |
| `**/*.events.txt`   | `editor-events.html`       | Subscribes to the four v1 topics and records sequences and events                                                                                  |
| `**/*.txt`          | `editor.html`              | Read, report dirty, save with a `[fixture save N]` marker, acknowledge dispose                                                                     |
| `**/*.append.txt`   | `editor-append.html`       | Same, with an `[fixture append N]` marker and a second visible edit signal                                                                         |
| `**/*.repeat.txt`   | `editor-repeat.html`       | Requests the same file twice and records both versions in `#observation`                                                                           |
| `**/*.neverack.txt` | `editor-never-ack.html`    | Ignores `shell/dispose` so the 1 s teardown timeout is observable                                                                                  |

The `events` mode subscribes to `theme/changed`, `workspace/file-changed`,
`workspace/closed` and `config/changed` after `shell/init`. `#observation`
records `init` (theme, workspace name and the resolved `settings`),
`subscriptions` (the `shell/subscribed` replies with their sequence numbers) and
`events` (the `shell/event` payloads). A `config/changed` event also replaces the
recorded `settings` with the event's full value map. It stays clean on open; an
external change re-reads the file, applies a local edit and reports dirty so a
following save is observable. The other modes do not subscribe, so they receive
no topic events.

## Local events

`editor-local-events.html` is a visible handler for `**/*.local.txt`. It
subscribes to `local/fixture` after `shell/init`, stores the
`shell/subscribed` sequence in `observation.local.subscription`, and renders a
**Publish local event** button. A click sends one correlated `plugin/publish`
with `{ path, n }`; the acknowledgement is appended to
`observation.local.published` and each delivered event, including `from` and
the payload, is appended to `observation.local.events`. The page stays clean on
open so the check does not prompt a save.

Open two `.local.txt` files with the same manifest to see each frame receive the
other frame's event and its own event with its own `exo-session` in `from`.
`other-manifest.json` declares a second plugin id with `**/*.local-other.txt`;
open one of each to confirm the same topic name does not cross the identity
boundary.

## Contributed settings

The fixture manifest declares three workspace-scoped settings:

| Setting            | Type    | Default              | Purpose                         |
| ------------------ | ------- | -------------------- | ------------------------------- |
| `fixture.greeting` | string  | `hello from fixture` | Free text reported in the frame |
| `fixture.repeat`   | boolean | `false`              | Boolean toggle for the checks   |
| `fixture.size`     | number  | `1` (enum `1,2,3`)   | Numeric enum for the select     |

They are shell-owned: changing one writes IndexedDB, never `exo.json` or a
workspace file. `shell/init` carries the resolved values; `config/changed`
carries the full new map to subscribed frames of this plugin only.

## Manual checks against the deployed shell

1. Add the deployed manifest to `exo.json` and open any `.txt` file. One handler
   frame should mount; the tab shows the editor label and the document area holds
   no textarea.
2. The fixture requests the file after `shell/init`; `#observation` in the frame
   lists the read version and length.
3. The fixture reports dirty; the tab dot appears and closing the tab prompts.
4. Save writes the file with a marker appended. Reopening shows the saved text.
5. Edit the file on disk while it is open: the frame records
   `shell/file-changed`, the tab shows the external-change notice, and a save
   reports `conflict` without overwriting the newer content.
6. Close the tab or disable the plugin: the frame receives `shell/dispose` (or is
   removed after the timeout) and a clean document falls back to the text editor.
7. A plugin with only `workspace:read` gets an editor with no Save action; a
   read-only workspace behaves the same.
8. Open `events.events.txt` with the events editor. `#observation` shows
   `subscriptions` with `seq: 0` for all four topics and `init.theme` matches the
   current theme. Toggling the theme appends one `theme/changed` event; a `.txt`
   opened with the default editor records none.
9. Write the open file externally while the events editor is mounted: the frame
   records the targeted `shell/file-changed`, re-reads the file, and appends one
   `workspace/file-changed` with the new version. Save after that and confirm one
   more `workspace/file-changed` after `shell/save-result`; switching away without
   saving should not prompt.
10. Switch or close the workspace: the events frame records `workspace/closed`
    with `switch` or `close` before `shell/dispose`, and `#observation` stops
    changing afterwards.
11. Enable `readonly-manifest.json` instead: its events editor opens and every
    subscription is answered with `permission-denied` in `errors`.
12. Open Settings > Plugins with the deployed manifest: the fixture entry shows
    the string, boolean and enum controls with the manifest defaults and
    descriptions.
13. Open `events.events.txt`, change `fixture.greeting` in Settings > Plugins,
    and confirm the frame records exactly one `config/changed` with
    `{ pluginId, values }` for the full map. Open a new `.txt` document and
    confirm its `shell/init.settings` already carries the new value.
14. Reload the page with the same workspace: Settings and `shell/init` show the
    changed value. Switch to a second workspace: the defaults are shown and the
    first workspace's value is not delivered. Switch back: the value returns.
15. Seed an invalid stored value: in DevTools > Application > IndexedDB >
    `exo-plugin-settings` > `settings`, edit the record for the workspace and set
    `values[<identity>]['fixture.size'] = 9`, then reload. The settings surface
    warns for `fixture.size`, the fixture receives the default `1`, and the
    workspace stays usable.
16. Confirm a setting change does not modify `exo.json`, create a workspace file
    or open a document tab.
17. Enable `readonly-manifest.json`: the settings block still renders and stays
    editable, and the "does not subscribe to configuration changes" hint appears
    because that manifest lacks `events:subscribe`. The events editor's
    subscriptions remain `permission-denied`.
18. Open `picker.picker.txt`. The fixture renders a visible frame with a **Pick
    workspace file** button. Click it: the shell picker opens at the fixture
    file's directory, `exo.json` and `.exo` are absent, and selecting a text file
    appends `[fixture picked <path>]` to the fixture buffer in `#observation`,
    reports dirty and saves through the normal Save action.
19. Cancel the picker: `#observation.picks` records one entry with `paths: []`,
    the tab stays clean and no read follows. Press Escape or use only the
    keyboard to select a row; focus returns to the plugin frame when the picker
    closes.
20. Open `picker.picker.txt` with `readonly-manifest.json`: the picker still
    returns paths and the fixture reads them, but the shell offers no Save. A
    hidden `.txt` editor has no Pick button and a picker request from it is
    denied.
21. Open `listing/one.list.txt` with the deployed manifest. The listing fixture
    probes `plugin/request-list` in order: the workspace root (absolute), its own
    directory (relative `.`), `/listing/big`, its own file path, a missing path
    and `/exo.json`. `#observation.lists` records each page's entry count, the
    first five entries with path/kind/size, the raw first entry, `nextCursor` and
    the number of reserved entries; `errors` records `not-a-directory` for the
    file,
    `not-found` for the missing path and `permission-denied` for `/exo.json`.
    `#observation.listReads` proves a listed path is read through
    `plugin/request-file`.
22. Create `listing/big/` with 1,001 files and reopen the document. The
    `list-big` page records `count: 1000` and a `nextCursor`, and the follow-up
    `list-big-2` page records the remaining entry without a cursor. A 1,001-entry
    root page also continues automatically as `list-root-2`.
23. Enable `readonly-manifest.json` instead and open the same document. Every
    listing request is answered with `permission-denied` and no `lists` page is
    recorded, because that manifest declares only `workspace:read`.
24. Switch to another workspace while the listing page is in flight: the old
    frame is disposed, no late `list-result` is recorded, and the new workspace
    starts with no listing state. Disabling the plugin or closing the tab has the
    same effect.
25. Open `one.local.txt` with the deployed manifest. `observation.local`
    records `subscription: { topic: 'local/fixture', seq: 0 }`. Press **Publish
    local event**: `published` records `{ topic: 'local/fixture', seq: 1 }` and
    `events` records one event with `from` equal to the frame's
    `exo-session`.
26. Keep it open and open `two.local.txt`. Press Publish in the second frame:
    switch back to the first and confirm it recorded the second frame's event
    with the second `from`; the second frame also records its own event. The
    sequences increase per identity and topic.
27. Add `other-manifest.json` to `exo.json`, approve its consent and open
    `three.local-other.txt`. Press Publish in both plugins: neither plugin's
    `local.events` contains the other plugin's event or `from`, while each
    receives its own.
28. Send an oversized local publish or a shell topic through DevTools and
    confirm `errors` records `too-large` with the 1 MiB limit or
    `permission-denied` for `theme/changed`; no `published` entry is added. A
    publish from the registration frame is a protocol violation and produces no
    event.

Changes are only observed for open documents plus the shell's own writes; both
providers are non-watchable, so an unopened file is not reported.

No secrets, backend or build step are involved.

## Panels and content views

The manifest also declares a primary panel (`fixture-panel`), two secondary
panels (`fixture-inspector`, `fixture-inspector-2`), a bottom panel
(`fixture-inspection`) and a content view (`fixture-tutorial`). The controller
registers all of them. The pages are dependency-free views that perform the
`exo-mode=view` handshake and mirror `{ view, capabilities, activeEditor,
settings, subscriptions, events, snapshots, results, errors }` into
`#observation` and the title.

- `view-primary.html` is the hub: Publish local event, Subscribe theme, Open
  `/notes.txt`, Toggle secondary panel, Open fixture content view and Open the
  other plugin's view.
- `view-secondary.html` can hide itself and open the content view.
- `view-content.html` shows the read-only content view; the `payload` and
  `openedBy` fields in `#observation` distinguish a panel open, a shell palette
  open and a cross-plugin open.

`fixture-tutorial` declares `companionPanel: "fixture-inspector"`. Opening the
content view from the shell palette or from `view-primary.html` reveals the
secondary **Fixture Inspector** panel. Opening the view again focuses the same
instance and reveals the panel again. Opening it twice from the shell palette
creates two instances; closing one keeps the inspector until the last tab
closes. A manual hide of the inspector stays hidden until the content view is
opened or focused again, and selecting another secondary panel does not make a
later content-view close dismiss that panel.

Manual companion checks:

1. Open **Fixture Tutorial** from the shell palette. The right side bar shows
   **Fixture Inspector** and the content tab renders.
2. Hide the inspector with its close control. It stays hidden while the content
   tab remains active; re-open or refocus the content view and it returns.
3. Open **Fixture Tutorial** twice from the palette, then close one tab. The
   inspector remains visible while the other tab is open; close the second tab
   and it hides.
4. Select another secondary view, then close the content tab. The other panel
   stays visible and the right side bar does not close.

The other fixture manifest declares `other-tutorial` and uses
`other-plugin.html` as its controller, so the cross-plugin open has a real target
identity. A same-origin copy runs with `allow-scripts` only; `storage` in the
view observation is therefore `unavailable`.

## Commands

The manifest declares four commands and the controller registers all four ids:

| Command            | Target                          | Surfaces                       | Behaviour                                                  |
| ------------------ | ------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `fixture.format`   | active editor                   | palette, editor action row     | Records the invocation and answers `{ ok: true }`          |
| `fixture.generate` | panel `fixture-panel`           | palette, explorer context menu | Reveals the panel and records `{ path, kind }`             |
| `fixture.inspect`  | content view `fixture-tutorial` | palette                        | Opens or focuses one `command/fixture.inspect` tab         |
| `fixture.fail`     | active editor                   | palette                        | Answers `{ ok: false, message: "Fixture command failed" }` |

The editor and view pages push each invocation into `observation.commands` and
include the count in the document title. Manual checks:

1. Open a `*.txt` file. The document action row shows **Format Fixture** with an
   accessible name that includes the plugin. Run it: the editor observation
   records `fixture.format` with no `args`, and no notice appears.
2. Open the explorer context menu on a file and on a folder. Both list
   **Generate Fixture Report (Exo Host Fixture)**. Run each: the primary panel is
   revealed (lazily on the first run) and its observation records `{ path, kind }`
   with `kind: "file"` or `kind: "directory"`.
3. Run **Inspect Fixture View** twice. One content-view tab opens and the second
   run focuses it; the content observation records two invocations for
   `command/fixture.inspect`.
4. Run **Fail Fixture Command** from the palette. A plain-text status notice
   names the plugin, can be dismissed, and disappears after eight seconds.
5. Run **Timeout Fixture Command**, wait ten seconds, and confirm a timeout
   notice appears while the editor frame stays mounted.
6. Disable the fixture in Settings. Every palette, explorer and action-row entry
   disappears; a stale palette entry performs no delivery and appears in the
   plugin log as `stale`.

## New-file templates and runtime creation

The manifest declares two templates and the controller registers both ids:

| Template         | Default name           | Content                    |
| ---------------- | ---------------------- | -------------------------- |
| `fixture.text`   | `fixture-template.txt` | `Hello from the fixture…`  |
| `fixture.binary` | `fixture-pixel.bin`    | base64 bytes `00 01 02 ff` |

The content view `fixture-generator` uses the same page and has **Create generated
text** and **Create generated bytes** buttons; each sends
`plugin/request-new-file` and records the result in `observation.results`.

Manual checks:

1. In a writable workspace, open the explorer New File menu. It offers **Empty
   File** and both templates under **Exo Host Fixture**; the palette also lists
   one entry per template with the plugin name as its category.
2. Choose **Fixture Text Template** from a selected folder. The Save As dialog
   names the plugin, starts in that folder, pre-fills `fixture-template.txt`,
   shows the size and the text preview. Create it: the file appears, opens, and
   contains the exact template text.
3. Add `notes.txt` first if needed, then create a template with an existing
   name. The dialog reports that the name exists, stays open, and the existing
   file is unchanged. Rename and create successfully.
4. Choose **Fixture Binary Template**. The dialog shows a byte size and a binary
   label and no preview. Create it and confirm the bytes are `00 01 02 ff`.
5. Open **Fixture Generator**, choose **Create generated text**, confirm in the
   dialog, and read `observation.results`: it records
   `shell/new-file-result` with a path and version and no tab opens for the
   generated file. Repeat with **Create generated bytes** and confirm the exact
   bytes. Choose **Create oversized text**: no dialog opens and `errors` records
   `too-large` with a message naming 8388608 bytes.6. Disable the plugin while the dialog is open. The dialog closes without a
   write. Switch workspaces with a dialog open: it closes before the old session
   is released, and neither workspace gains the file.

## Editor-bound bottom panel

`fixture-inspection` is a bottom panel. It shows `activeEditor` from
`shell/init`, subscribes to `editor/active`, and exposes **Request snapshot**,
**Apply panel edit** and **Undo panel edit** buttons. `editor-bound.html` is a
visible handler for `**/*.bound.txt`; it subscribes to the same local topic,
checks the target `instanceId`, replies with a snapshot, applies an edit through
a small history stack, reports dirty, and saves with the normal marker.

Manual checks:

1. Open a `*.bound.txt` file. The bottom region shows **Fixture Inspection** and
   the panel observation records the active path and instance id.
2. Open a second `*.bound.txt` file and switch tabs. The panel follows the active
   tab and records the new path/instance id; the inactive editor keeps its own
   instance id.
3. Choose **Apply panel edit**. The active editor appends the panel text, reports
   dirty, and the panel records the applied snapshot. Choose **Undo panel edit**:
   the editor restores the previous buffer and stays dirty.
4. Save with the tab's Save action. The file receives the normal fixture marker;
   the panel does not write the file itself.
5. Switch to `notes.txt` (shell text) or to the other plugin's editor. The panel
   receives `activeEditor: null` and shows no active path.
6. Open a bottom panel tab that is not active: no iframe is created until that
   tab is selected. Close and reopen the bottom region: the retained frame is
   shown without a new handshake.
