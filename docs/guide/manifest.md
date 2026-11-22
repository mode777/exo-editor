# Manifest

A workspace declares plugins in `exo.json`; each entry points at a manifest URL.
The shell fetches and validates the manifest before any frame exists, then shows
consent for its origin and capability fingerprint.

The normative field table, validation rules and examples are in
[`docs/contracts/plugin-manifest.md`](../contracts/plugin-manifest.md). This page
is the author-facing walkthrough; if they disagree, the contract wins.

## Workspace declaration

`exo.json` lives at the workspace root and is shell-owned. Add one entry per
plugin:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "manifest": "https://plugins.example.com/markdown/exo-manifest.json",
      "enabled": true
    }
  ]
}
```

The URL must be absolute, `https` (or `http://localhost` in development), with no
credentials or fragment. The shell adds a valid entry through its settings
surface; it does not need a hand-written file, and saving the settings surface
rewrites the canonical form.

## A manifest

<!-- exo:manifest -->

```json
{
  "schemaVersion": 1,
  "id": "com.example.markdown",
  "name": "Markdown Editor",
  "version": "0.1.0",
  "description": "Edits Markdown files in the Exo shell.",
  "publisher": {
    "name": "Example"
  },
  "engines": {
    "exo": ">=0.1.0"
  },
  "runtime": {
    "entry": "plugin.html"
  },
  "permissions": ["workspace:read", "workspace:write"],
  "contributes": {
    "fileEditors": [
      {
        "glob": "**/*.md",
        "entry": "editor.html",
        "label": "Markdown",
        "priority": 10
      }
    ]
  }
}
```

`runtime.entry` is the controller page. Its directory is the **plugin root**: the
controller, every editor page and every follow-up page must stay inside it. The
manifest and its pages must share one origin. See
[hosting](./hosting.md#the-plugin-root).

`engines.exo` is the shell range your plugin needs. Use the range form from the
manifest contract; the shell rejects a manifest whose range excludes its version.
It is independent of the SDK version and the manifest `schemaVersion`.

## File editors

Each `contributes.fileEditors` entry maps a glob to a handler page:

- `glob`: the files this editor matches. Use the contract's glob syntax; do not
  invent brace or negation extensions.
- `entry`: relative HTML page inside the plugin root.
- `label`: short name shown in the tab header and settings.
- `priority`: higher wins when several plugins match. Declaration order breaks a
  tie.
- `rendering`: `"hidden"` (default) keeps the handler iframe invisible; `"frame"`
  asks the shell to display the sandboxed handler in the document area. The tab,
  breadcrumbs and Save action stay shell-owned either way.

A file editor contribution requires `workspace:read` or `workspace:write`.
`workspace:write` implies read.

## Panels and content views

Besides file editors, a manifest can declare side-bar panels and read-only
content-view tabs:

```json
"contributes": {
  "panels": [
    {
      "id": "outline",
      "title": "Outline",
      "icon": "list-tree",
      "location": "primary",
      "entry": "views/outline.html"
    },
    {
      "id": "asset-params",
      "title": "Parameters",
      "icon": "settings",
      "location": "secondary",
      "entry": "views/parameters.html"
    }
  ],
  "contentViews": [
    {
      "id": "tutorial",
      "title": "Tutorial",
      "entry": "views/tutorial.html",
      "companionPanel": "asset-params"
    }
  ]
}
```

A `primary` panel adds an activity-bar item; a `secondary` panel appears in the
right side bar through the shell's view picker. A content view opens as a
read-only tab with no save or close prompt. Declare at most 8 panels and 16
content views. The controller registers a subset by id with
`registerPanel(id)` / `registerContentView(id)`. Panels mount on first reveal and
stay hidden without disposal; content frames are created when their tab opens.

A content view can declare one optional `companionPanel`. It must name a
`secondary` panel declared in the same manifest. The shell reveals it when the
content view opens or is focused, keeps it open while another open content view
shares it, and hides it after the last such view closes. If the panel is not
registered, the content view still opens. The shell owns this lifecycle; you do
not send a message, poll or add a heartbeat. A hide by the user stays until the
next content-view open or focus, and `plugin/request-panel` keeps its existing
behavior.

Panels and content views are excluded from the consent fingerprint because they
are user-invoked. A manifest that adds them should set `engines.exo` to a range
that includes `0.3.0`, so older shells fail closed instead of rejecting the
unknown field. A manifest that uses `companionPanel` must include `0.6.0`. See
the [manifest contract](../contracts/plugin-manifest.md#32-panels-and-content-views).

## Commands

A command is an action the user starts from the palette, the explorer context
menu or the editor action row. It runs in a frame the plugin already owns:

```json
"contributes": {
  "panels": [
    { "id": "reports", "title": "Reports", "location": "primary", "entry": "reports.html" }
  ],
  "commands": [
    {
      "id": "format",
      "title": "Format Document",
      "category": "Editing",
      "target": "activeEditor",
      "menus": ["commandPalette", "editor/title"]
    },
    {
      "id": "generate",
      "title": "Generate Report",
      "target": { "kind": "panel", "id": "reports" },
      "menus": ["commandPalette", "explorer/context"]
    }
  ]
}
```

Targets are `activeEditor`, one of your panels or one of your content views. A
view target must be declared in the same manifest and registered in the same
session, or registration rejects the command with `target-not-registered`.
`editor/title` requires an `activeEditor` target; `explorer/context` requires a
panel or content-view target; the palette is the default. Declare at most 32
commands.

An explorer invocation carries `{ path, kind }` for the selected entry; palette
and editor-title invocations carry no arguments. Long work belongs in a panel
that reports its own progress: a command result must arrive within ten seconds.
Commands are excluded from the consent fingerprint and named after your plugin
on every surface. Set `engines.exo` to a range that includes `0.4.0`, so an older
shell fails with `incompatible-engine` instead of rejecting the unknown field.
See the [manifest contract](../contracts/plugin-manifest.md#33-commands).

## New-file templates

A template offers a fixed file the user can create from the explorer New File
menu or the palette. It is plain manifest data, at most 20 entries, 64 KiB per
decoded template and 128 KiB total:

```json
"contributes": {
  "newFiles": [
    {
      "id": "component",
      "label": "TypeScript component",
      "fileName": "Component.tsx",
      "content": "export function Component() {}\n"
    },
    {
      "id": "pixel",
      "label": "One-pixel PNG",
      "fileName": "pixel.png",
      "encoding": "base64",
      "content": "iVBORw0KGgo="
    }
  ]
}
```

`content` is UTF-8 unless `encoding` is `base64`, which must be strict base64.
The shell decodes it once at validation and never evaluates template syntax.
`fileName` is one segment and must not be `exo.json` or `.exo`; it is only the
default in an editable shell-owned dialog. Your registration frame registers a
subset with `registerNewFile(id)` after approval. Templates require
`workspace:write`; without it, registration is rejected and nothing is offered.
Templates are excluded from the consent fingerprint, listed in the first-grant
prompt, and removed when the plugin stops. Set `engines.exo` to include `0.5.0`.

## Permissions

| Permission | What it allows |
| --- | --- |
| `workspace:read` | Read known paths it opens or requests, and paths the user selects in its picker. |
| `workspace:write` | Save changes to workspace files through the normal save flow. Requires `workspace:read`. |
| `workspace:list` | Enumerate one directory level at a time through `plugin/request-list`. Requires `workspace:read`. |
| `events:subscribe` | Subscribe to the v1 shell event topics and exchange `local/` messages with this plugin's own frames. |

Listing is separate from reading so the consent text can name discovery
explicitly. Adding `workspace:list` to an already-approved reader changes the
consent fingerprint and re-prompts; a plugin that keeps only `workspace:read`
keeps its stored consent. A manifest that uses listing should set an
`engines.exo` range that includes a listing-capable shell. Listing returns paths,
kinds and file sizes only; bytes still come from `plugin/request-file`.

## Optional pieces

- `contributes.configuration` declares workspace-scoped settings. The shell
  renders the controls and delivers values in `shell/init` and
  `config/changed`; values are stored by the shell, not written into `exo.json`.
- `contributes.fileEditors[].rendering` opts into the visible handler surface.
- `events:subscribe` lets the handler subscribe to the v1 event topics and
  publish or subscribe to `local/<name>` topics for its own frames.

Do not add fields that the contract does not define. Validation is
all-or-nothing: one unknown field or invalid page means the whole manifest is
reported and no code loads.

## Versioning

`schemaVersion` is the manifest format version and the shell accepts exactly the
version in the contract. `version` is your plugin version and is informational.
`engines.exo` is a SemVer range checked against the shell. SDK compatibility is
separate; see [`docs/releases.md`](../releases.md) and
[`docs/contracts/plugin-sdk.md`](../contracts/plugin-sdk.md).

Next: [the plugin root and hosting](./hosting.md) or
[the protocol flow](./protocol.md).
