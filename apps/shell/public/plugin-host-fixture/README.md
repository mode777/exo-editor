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

| Purpose              | URL                                               |
| -------------------- | ------------------------------------------------- |
| Normal registration  | `http://localhost:5174/exo-manifest.json`         |
| Missing CORS         | `http://localhost:5174/no-cors/exo-manifest.json` |
| Never sends `ready`  | `http://localhost:5174/never-ready-manifest.json` |
| Widened capabilities | `http://localhost:5174/widened-manifest.json`     |
| Duplicate identity   | `http://localhost:5174/duplicate-manifest.json`   |

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

| File glob           | Page                    | Behaviour                                                                       |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `**/*.list.txt`     | `editor-list.html`      | Probes `plugin/request-list`: root, relative, large, file, missing and reserved |
| `**/*.picker.txt`   | `editor-picker.html`    | Visible frame with a Pick button; exercises `plugin/request-files`              |
| `**/*.events.txt`   | `editor-events.html`    | Subscribes to the four v1 topics and records sequences and events               |
| `**/*.txt`          | `editor.html`           | Read, report dirty, save with a `[fixture save N]` marker, acknowledge dispose  |
| `**/*.append.txt`   | `editor-append.html`    | Same, with an `[fixture append N]` marker and a second visible edit signal      |
| `**/*.repeat.txt`   | `editor-repeat.html`    | Requests the same file twice and records both versions in `#observation`        |
| `**/*.neverack.txt` | `editor-never-ack.html` | Ignores `shell/dispose` so the 1 s teardown timeout is observable               |

The `events` mode subscribes to `theme/changed`, `workspace/file-changed`,
`workspace/closed` and `config/changed` after `shell/init`. `#observation`
records `init` (theme, workspace name and the resolved `settings`),
`subscriptions` (the `shell/subscribed` replies with their sequence numbers) and
`events` (the `shell/event` payloads). A `config/changed` event also replaces the
recorded `settings` with the event's full value map. It stays clean on open; an
external change re-reads the file, applies a local edit and reports dirty so a
following save is observable. The other modes do not subscribe, so they receive
no topic events.

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

Changes are only observed for open documents plus the shell's own writes; both
providers are non-watchable, so an unopened file is not reported.

No secrets, backend or build step are involved.
