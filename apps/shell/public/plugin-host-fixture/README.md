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
a save must not be offered.

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

| File glob           | Page                    | Behaviour                                                                      |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `**/*.events.txt`   | `editor-events.html`    | Subscribes to the four v1 topics and records sequences and events              |
| `**/*.txt`          | `editor.html`           | Read, report dirty, save with a `[fixture save N]` marker, acknowledge dispose |
| `**/*.append.txt`   | `editor-append.html`    | Same, with an `[fixture append N]` marker and a second visible edit signal     |
| `**/*.repeat.txt`   | `editor-repeat.html`    | Requests the same file twice and records both versions in `#observation`       |
| `**/*.neverack.txt` | `editor-never-ack.html` | Ignores `shell/dispose` so the 1 s teardown timeout is observable              |

The `events` mode subscribes to `theme/changed`, `workspace/file-changed`,
`workspace/closed` and `config/changed` after `shell/init`. `#observation`
records `init` (theme and workspace name), `subscriptions` (the `shell/subscribed`
replies with their sequence numbers) and `events` (the `shell/event` payloads).
The other modes do not subscribe, so they receive no topic events.

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
9. Save the open document twice quickly: the frame gets `shell/save-result`
   before one coalesced `workspace/file-changed`, and an external write is
   recorded as another `workspace/file-changed` with the new version.
10. Switch or close the workspace: the events frame records `workspace/closed`
    with `switch` or `close` before `shell/dispose`, and `#observation` stops
    changing afterwards.
11. Enable `readonly-manifest.json` instead: its events editor opens and every
    subscription is answered with `permission-denied` in `errors`.

Changes are only observed for open documents plus the shell's own writes; both
providers are non-watchable, so an unopened file is not reported.

No secrets, backend or build step are involved.
