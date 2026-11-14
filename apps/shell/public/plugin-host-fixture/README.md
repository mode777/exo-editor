# Plugin host fixture

A dependency-free stub plugin used to verify layer 4. It is copied into the
deployed shell at `/exo-editor/plugin-host-fixture/` and can also be served on a
second origin for the cross-origin checks.

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

## What it observes

The controller writes `{ mode, origin, storage }` to `#observation` and sets a
title such as `Exo fixture register available`. `storage` is `unavailable` when
the sandbox denies `localStorage`; that is expected for a same-origin plugin
mounted with `allow-scripts` only, and `available` for a cross-origin plugin with
`allow-scripts allow-same-origin`.

The controller registers `sibling.html` for `**/*.txt`. `sibling.html` is inside
the plugin root but is not one of the manifest's declared editor pages, so it
also exercises the "page inside the approved root" rule. The manifest's declared
`editor.html` is only opened by a later file-editor layer.

No secrets, backend or build step are involved.
