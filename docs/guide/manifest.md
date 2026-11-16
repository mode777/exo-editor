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
  header and Save action stay shell-owned either way.

A file editor contribution requires `workspace:read` or `workspace:write`.
`workspace:write` implies read.

## Optional pieces

- `contributes.configuration` declares workspace-scoped settings. The shell
  renders the controls and delivers values in `shell/init` and
  `config/changed`; values are stored by the shell, not written into `exo.json`.
- `contributes.fileEditors[].rendering` opts into the visible handler surface.
- `events:subscribe` lets the handler subscribe to the v1 event topics.

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
