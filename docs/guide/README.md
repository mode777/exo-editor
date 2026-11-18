# Plugin author guide

This guide is for building an Exo editor plugin: a static web page that the
shell loads in a sandboxed iframe and talks to over a versioned `postMessage`
protocol. The shell owns the workbench, the workspace and consent; the plugin
owns the editor surface.

## What you build

A plugin is a directory served over HTTPS with:

- `plugin.html` - the controller page. It registers one or more file editors and
  is then removed.
- `editor.html` - the handler page opened per matching file. It reads bytes on
  request, reports dirty state and answers save requests.
- `exo-manifest.json` - the manifest the shell fetches, validates and shows for
  consent.
- `src/*.ts` - your editor code, normally built with `@exo/plugin-sdk`.

The starter is [`packages/plugin-template`](../../packages/plugin-template/README.md).
The Monaco reference editor is [`apps/code-plugin`](../../apps/code-plugin/README.md).
Both are built only on the SDK and deployed as child paths of the shell site.

## Quickstart

From this repository root:

```bash
npm install
npm run dev:template
```

The template serves `http://localhost:5175/` with CORS. In a workspace's
`exo.json`, add:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "manifest": "http://localhost:5175/exo-manifest.json",
      "enabled": true
    }
  ]
}
```

Open the shell with `npm run dev` at `http://localhost:5173/exo-editor/`, open
that workspace, approve consent and create a `*.template.txt` file. The template
editor opens, reports dirty and saves a marker.

For a production plugin, copy the template's structure, change the manifest
fields in [manifest.md](./manifest.md), and keep the controller and editor pages
free of hand-written envelopes and `postMessage` calls. The SDK is private to
this repository in v1; see the compatibility section of
[`docs/contracts/plugin-sdk.md`](../contracts/plugin-sdk.md).

## The four pieces

1. [Manifest](./manifest.md): `exo-manifest.json` declares your identity,
   permissions, controller entry and file-editor globs. `exo.json` in the
   workspace references its URL.
2. [Protocol](./protocol.md): the handshake, registration, file handler, save
   and dispose flow. Read this if you are debugging or not using the SDK.
3. [SDK](./sdk.md): the typed client for the controller and editor pages.
4. [Hosting](./hosting.md): HTTPS, CORS, same-origin versus cross-origin framing
   and the plugin root rule.
5. [Consent](./consent.md): what the user sees and when the shell asks again.

## Check your plugin

- [Hosting checklist](./hosting.md#checklist) passes, including CORS.
- The manifest validates against [`schema/exo.schema.json`](../../schema/exo.schema.json).
- The controller registers only declared globs and completes.
- The editor reads on request, keeps content out of `shell/init`, reports dirty
  honestly and answers saves.
- The plugin never reads `exo.json`, `/.exo/**`, a `FileSystemHandle` or the
  parent DOM.
- [Testing and troubleshooting](./testing.md) covers the local and deployed
  checks.

## Agent skill

[`.agents/skills/create-exo-plugin/SKILL.md`](../../.agents/skills/create-exo-plugin/SKILL.md)
is a single-file skill for coding assistants: it scaffolds a standalone plugin
repo from this template, vendors the SDK and ships to GitHub Pages. Outside
this repository, install it by its raw file link.

## Dry run

On 2026-11-16 the quickstart was followed from this guide and the template
README alone, without reading shell source. Two gaps were found and fixed: the
SDK editor example used a nonexistent `isDirty` getter, and the event example
checked a nonexistent `capabilities.events` flag instead of
`initialization.permissions`. The deployed template then registered, read the
36-byte file, saved `[template save 1]` and had its frame removed when the tab
closed. See the [walkthrough](../walkthrough.md) for the recorded path.

All normative limits, error codes and field tables live in
[`docs/contracts/`](../contracts/). This guide links to them instead of copying
them; if a value differs, the contract wins.
