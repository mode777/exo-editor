# Hosting

A plugin is static files. The shell never proxies, bundles or executes your
server code. The deployed shell is `https://mode777.github.io/exo-editor/`; your
plugin can be cross-origin or a same-origin child path.

## Requirements

- Serve the manifest and pages over HTTPS. `http://localhost` is allowed for
  development only.
- The manifest URL must be absolute, with no credentials and no fragment.
- Send `Access-Control-Allow-Origin` for the manifest. The shell fetches it
  cross-origin; a missing header is reported as a CORS failure naming your
  origin.
- Serve the manifest as JSON (`application/json`) and the pages as HTML.
- Keep the controller entry, editor pages and every follow-up page inside the
  plugin root (see below).
- No cookies, storage or server state are needed. The shell can host a
  first-party plugin under its own origin with an opaque sandbox; a plugin that
  needs storage must live on a separate origin.

## The plugin root

`runtime.entry` is the controller page. Its directory is the plugin root.
`contributes.fileEditors[].entry` and every page you navigate to must be a
sibling or descendant of that root. Parent traversal and unrelated directories
are rejected after normalization, and consent covers the root (D14). For example,
with `runtime.entry: "plugin.html"` at the manifest origin root, `editor.html`
and `editors/code.html` are valid; `../shared/editor.html` is not.

The manifest and all pages must share one origin. A redirect to another origin is
rejected.

## Same-origin and cross-origin

| Where the plugin is served | Frame sandbox | Storage | Consent warning |
| --- | --- | --- | --- |
| Different origin | `allow-scripts allow-same-origin` | The plugin keeps its own origin storage | None |
| Shell origin (child path) | `allow-scripts` | Opaque origin: no localStorage, IndexedDB, cookies or service workers | States that the plugin cannot be isolated by origin |

A same-origin plugin's messages report `event.origin === "null"`; identity is the
iframe instance plus the session id echo. Do not depend on `window.origin` or
storage in that mode. The template and code plugin are storage-free for this
reason.

## Local development

The template serves `http://localhost:5175/` with CORS (`npm run dev:template`);
the code plugin serves `http://localhost:5176/` (`npm run dev:code`). Add the
manifest URL to the workspace `exo.json`:

```text
http://localhost:5175/exo-manifest.json
http://localhost:5176/exo-manifest.json
```

The shell's CSP permits `frame-src http://localhost:*` and
`connect-src http://localhost:*` only for this development rule. Other plain-HTTP
origins are rejected.

## Checklist

- [ ] Manifest URL is absolute, HTTPS (or localhost), no credentials or fragment.
- [ ] `runtime.entry` and every `fileEditors[].entry` are inside the plugin root.
- [ ] Manifest and pages share one origin.
- [ ] `Access-Control-Allow-Origin` is present for the manifest.
- [ ] `Content-Type: application/json` for the manifest; HTML for pages.
- [ ] No `postMessage`, envelope or handshake code outside the SDK.
- [ ] No `exo.json` or `/.exo/**` access, no parent DOM, no file handle request.
- [ ] Same-origin builds do not use storage.
- [ ] The controller registers only globs declared in the manifest and completes.
- [ ] The editor handles read, dirty, save, external change and dispose.
- [ ] A protocol-mismatch page reports the SDK error instead of hanging.

## Size and limits

The manifest size, fetch timeout, payload and file caps are fixed by the
contracts and advertised to the editor in `shell/init.limits`. Do not copy the
numbers into your documentation; read
[`docs/contracts/plugin-protocol.md`](../contracts/plugin-protocol.md) and
[`docs/contracts/plugin-manifest.md`](../contracts/plugin-manifest.md).

Next: [consent](./consent.md) or [testing](./testing.md).
