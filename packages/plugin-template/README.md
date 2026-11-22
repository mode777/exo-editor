# Plugin template

A minimal headless plugin built only with `@exo/plugin-sdk`. It is the starter
for plugin authors and the SDK's deployed conformance fixture.

## Run on a second origin

```bash
npm run dev:template
```

This serves `http://localhost:5175/` with CORS enabled. Add this manifest URL to
`exo.json` in a workspace:

```text
http://localhost:5175/exo-manifest.json
```

The shell runs on `http://localhost:5173/exo-editor/`. The template never uses
`localStorage`, IndexedDB, cookies or parent DOM access, so the same pages work
when the shell ships them from its own origin with the stricter
`sandbox="allow-scripts"` rule.

## Deployed copy

The shell build copies `packages/plugin-template/dist` to
`/exo-editor/plugin-template/` after the bundle budget check. The deployed
manifest is:

```text
https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json
```

The protocol-mismatch diagnostic is:

```text
https://mode777.github.io/exo-editor/plugin-template/exo-manifest-mismatch.json
```

## Files

| Path                                                  | Purpose                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `plugin.html` / `src/controller.ts`                   | Registration controller: connects, registers `**/*.template.txt`, completes, records the ack                   |
| `editor.html` / `src/editor.ts`                       | Editor handler: reads, reports dirty, appends a save marker, re-reads on external change, acknowledges dispose |
| `negative/protocol-mismatch.html` / `src/mismatch.ts` | Diagnostic page that requests protocol major 2 and surfaces the SDK error                                      |
| `public/exo-manifest.json`                            | Normal manifest, priority 50 so it wins over the generic fixture                                               |
| `public/exo-manifest-mismatch.json`                   | Manifest for the diagnostic page; declares no file editors                                                     |

The pages mirror their state into `#observation` and the document title because
handler frames are hidden.

## Giving the template a visible surface

The starter is deliberately headless, so it has no palette. If you switch it to
`rendering: "frame"` or build a view page, import `@exo/plugin-sdk/theme.css`,
call `followTheme(client)` from `@exo/plugin-sdk/theme`, and style the page with
the `--exo-*` tokens. See [`docs/guide/styling.md`](../../docs/guide/styling.md).

## Manual checks against the deployed shell

1. Add the deployed manifest URL to `exo.json`, approve consent, and confirm the
   dialog shows the same-origin warning. The controller should report
   `phase: complete` with `accepted: ["**/*.template.txt"]`.
2. Create `hello.template.txt`, open it, and confirm the tab shows the
   `Exo Template` editor. The hidden frame's `#observation` should list one read
   with the file version and no file bytes before that read.
3. The editor reports dirty; click Save. The file should contain the original
   text plus `[template save 1]`, and the tab should clear the dirty dot.
4. Write the file externally while it is open. The frame should record
   `external`, re-read the file and report dirty again.
5. Close the tab. The frame should receive dispose and stop updating; no iframe
   should remain.
6. Add `exo-manifest-mismatch.json` instead. The shell log should report
   `unsupported-version`, the diagnostic page's console should show expected and
   received protocol versions, and no editor should register.
7. Confirm the template never writes storage: in DevTools, the frame's
   `localStorage` access throws and the pages still work.
