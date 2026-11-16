# Exo Code example workspace

This folder is a workspace for checking the reference Monaco plugin against the
deployed shell.

1. Open `https://mode777.github.io/exo-editor/` in Chromium.
2. Open this folder.
3. Approve the `Exo Code` consent prompt. It names the deployed origin and says
   the plugin renders its own editor surface.
4. Open `hello.ts`, `data.json` and this file. Each should show the Monaco
   editor; the tab header still belongs to the shell.
5. Edit a file and use the shell's **Save** action. Reload the page and confirm
   the saved text survives.
6. Change the shell theme and confirm the Monaco theme follows.
7. Disable `Exo Code` in settings and open `hello.ts` again; the shell text
   renderer should be used and no plugin frame should remain.

For local development, serve the plugin with `npm run dev:code` and replace the
manifest URL in `exo.json` with:

```text
http://localhost:5176/exo-manifest.json
```

The same build works cross-origin because the dev server enables CORS. The
deployed same-origin copy runs with `sandbox="allow-scripts"` and has no storage.

To check the large-file guard, create a file above 5 MiB and open it. The plugin
shows a message and does not create a Monaco model; the shell stays responsive.
