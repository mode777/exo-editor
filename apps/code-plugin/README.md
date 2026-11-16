# Exo Code

The Monaco-based reference editor for the Exo shell. It is built only with
`@exo/plugin-sdk`, deployed as a child path of the shell site, and loaded through
the same manifest, consent, sandbox and handler protocol as any third-party
plugin. The shell contains no Monaco code and has no reference-editor-specific
path.

## Run on a second origin

```bash
npm run dev:code
```

This serves `http://localhost:5176/` with CORS enabled. Add this manifest URL to
`exo.json` in a workspace:

```text
http://localhost:5176/exo-manifest.json
```

The shell runs on `http://localhost:5173/exo-editor/`. The dev server is a
cross-origin plugin, so the shell frames it with
`sandbox="allow-scripts allow-same-origin"`; the plugin can use storage there,
although the reference editor does not depend on it.

## Deployed copy

The CI build runs `npm run build:code` with
`EXO_CODE_PLUGIN_BASE_PATH=/exo-editor/code-plugin/` and copies the output into
the Pages artifact after the shell budget, CSP and custom-element checks:

```text
https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json
```

The deployed copy is same-origin with the shell, so it runs with
`sandbox="allow-scripts"` and has an opaque origin: no `localStorage`, IndexedDB,
cookies, service workers or parent DOM access. Monaco is configured without
storage and its workers are bundled inline, so the surface still works.

## What it does

- Registers `**/*.{ts,tsx}`, `**/*.{js,jsx}`, `**/*.json` and `**/*.md` with
  `rendering: "frame"`.
- Loads Monaco in its own iframe, with the language selected from the file
  extension. There is no language server and no remote completion.
- Reports dirty state, answers the shell's save request with the current model
  text, keeps failed saves dirty and follows external changes without silently
  replacing a dirty buffer.
- Applies the initial shell theme and subscribes to `theme/changed`.
- Refuses files above 5 MiB (or a lower shell limit) without reading them.

Ctrl/Cmd+S inside Monaco sends an id-less `plugin/request-save` intent when the
document is dirty and writable. The shell then runs the normal save round trip:
it sends `shell/request-save`, the plugin returns the model text, and
`shell/save-result` updates the state. The shell's **Save** action remains
available and is the fallback for a shell that predates the notification.

The editor exposes `window.__exoCode` inside its own sandboxed document for
diagnostics (`value()`, `setValue(text)`, `state()`). It carries no shell state
and is not a protocol surface; the deployed verification uses it to inspect the
model after keyboard and save checks.

## Manual checks

1. Add the deployed manifest URL, approve consent, and confirm the dialog shows
   the same-origin warning and the frame-rendering disclosure.
2. Open a `.ts`, a `.json` and a `.md` file. Each should show a visible Monaco
   editor; the tab, header and Save button remain shell chrome outside it.
3. Edit and save each file with the shell Save button and with Ctrl/Cmd+S;
   reload and confirm the text survives. The tab's dirty dot clears on a
   successful save and stays set after a conflict.
4. Change the shell theme and confirm Monaco follows without reopening the file.
5. Switch tabs and return. The editor keeps its session and content; it is not
   remounted by the tab switch.
6. Disable the plugin in settings. Matching files fall back to the shell text
   renderer and no plugin frame remains.

## Files

| Path                       | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `plugin.html`              | Registration controller                                              |
| `editor.html`              | Visible Monaco handler page                                          |
| `src/controller.ts`        | SDK-only registration of the four globs                              |
| `src/editor.ts`            | Monaco setup, workers, dirty/save/external-change and theme handling |
| `src/languages.ts`         | Extension, theme and large-file helpers                              |
| `public/exo-manifest.json` | Plugin manifest; pages resolve inside the deployed child path        |
