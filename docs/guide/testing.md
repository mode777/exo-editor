# Testing and troubleshooting

Use the template as the first test, then your own plugin. The shell always owns
consent and the workspace; a plugin cannot fabricate either.

## Local

```bash
npm install
npm run dev:template   # http://localhost:5175/ with CORS
npm run dev            # http://localhost:5173/exo-editor/
```

Add `http://localhost:5175/exo-manifest.json` to the workspace `exo.json` (or
use the shell's Plugins settings). Approve the same-origin/cross-origin consent
state, create a `*.template.txt` file and open it. The template editor should
read the file, report dirty, save `[template save 1]` and dispose without a
protocol error.

For the Monaco reference plugin use `npm run dev:code` and
`http://localhost:5176/exo-manifest.json` with a `.ts`, `.json` or `.md` file.

## Deployed

The release demo is [`examples/demo-workspace`](../../examples/demo-workspace/README.md).
It declares the deployed code and template plugins and includes files for both
plus the shell text surface. The recorded acceptance path is
[`docs/walkthrough.md`](../walkthrough.md).

## What to check

- Consent shows the exact origin, permissions, globs and frame-rendering
  disclosure; no iframe is mounted before approval.
- The controller registers the declared globs and completes; the frame is gone
  afterwards.
- Opening a matching file mounts one handler and content is not sent until the
  plugin asks.
- The file picker opens only from an active visible handler, returns only the
  paths the user selected, hides `exo.json`/`.exo`, and leaves reads to
  `plugin/request-file`. Cancelling returns an empty path list.
- Listing returns one directory level of `path`/`kind`/`size` entries, hides
  `exo.json`/`.exo`, paginates with `nextCursor`, and answers a file path with
  `not-a-directory` and a missing directory with `not-found`. A plugin without
  `workspace:list` receives `permission-denied` and lists nothing.
- Dirty state reaches the tab, Save writes exact text or bytes, a conflict
  leaves the buffer and disk intact.
- An external change is visible and does not silently replace a dirty buffer.
- Closing the tab disposes the frame; a late save does not recreate the file.
- Disabling the plugin falls back to the shell text surface.
- A same-origin plugin has no storage and a cross-origin plugin keeps its own.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `cors` during manifest fetch | Missing `Access-Control-Allow-Origin` | Serve the header from the manifest origin; check the exact origin and no redirect |
| `unsupported-origin` | Entry page is outside the manifest origin | Serve the page from the manifest origin |
| `unsupported-version` | Protocol major mismatch | Use the SDK's `PROTOCOL_VERSION`; do not hard-code a different major |
| `incompatible-engine` | `engines.exo` excludes the shell | Widen the range to the contract's shipped form |
| `permission-denied` on a read | Missing `workspace:read`/`workspace:write`, or a reserved path | Fix the manifest; never request `exo.json` or `/.exo/**` |
| `not-found` / `not-a-file` | Wrong path or a directory | Resolve relative to the open file or use an absolute workspace path |
| `too-large` | File or payload exceeds the advertised limit | Ask for a smaller file/range or show a no-editor state |
| `timeout` in the plugin log | Controller never sent `ready`, or registration never completed | Check the SDK boot path and the frame's console |
| `unsupported-message` on a picker | Shell predates `plugin/request-files` or omits `filePicker` | Hide the picker action and fall back to manual path entry |
| `unsupported-message` on a listing | Shell predates `plugin/request-list` or omits `directoryListing` | Fall back to exact-path reads and the picker |
| `permission-denied` on a listing | Manifest lacks `workspace:list`, or the path is reserved | Add `workspace:read` and `workspace:list`; never list `/.exo` or `/exo.json` |
| `not-a-directory` / `not-found` on a listing | Path is a file, missing, or the cursor expired | List a directory, and re-list without a cursor after `not-found` |
| `protocol-violation` | Unknown message, wrong session, wrong mode or content outside save | Remove hand-written protocol code; use the SDK |
| Manifest rejected with no frame | Unknown field or invalid page | Validate against the schema and the contract's field table |

The complete code vocabulary is in
[`docs/contracts/plugin-protocol.md`](../contracts/plugin-protocol.md#6-errors)
and [`docs/contracts/plugin-manifest.md`](../contracts/plugin-manifest.md).

## Checklist before shipping

- [ ] A clean `npm ci` builds the plugin.
- [ ] The manifest validates with [`schema/exo.schema.json`](../../schema/exo.schema.json).
- [ ] The controller registers only declared contributions and completes.
- [ ] The editor handles read, dirty, save, conflict, external change, dispose
      and a rejected read with an actionable state.
- [ ] The plugin does not touch storage in same-origin mode.
- [ ] The plugin has no `postMessage`, envelope or handshake code outside the
      SDK.
- [ ] The deployed manifest URL works from the deployed shell.
