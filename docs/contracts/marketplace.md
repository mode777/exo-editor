# Marketplace Contract (v1)

Status: introduced by the OpenSpec change `plugin-marketplace`. Normative
requirements are mirrored in `openspec/specs/plugin-marketplace/spec.md`; the
shared shape is `schema/marketplace.schema.json`. This document adds the
semantic rules a JSON Schema cannot express.

## 1. Purpose

The marketplace is discovery, not distribution. A deployed shell reads a fixed
list of feed URLs from a same-origin file, fetches those feeds, and shows the
plugins they list. Installing a plugin writes its manifest URL to the current
workspace's `exo.json`; the existing plugin host then fetches, validates and
consents to that manifest.

There is no package download, no cache, no account, no rating, no ranking and no
automatic update. A feed cannot grant a capability, skip consent or mount a
frame.

## 2. Two documents

| Document | Where it lives | Purpose |
| --- | --- | --- |
| `marketplace-sources.json` | Shell origin, next to the shell document | The deployment's fixed feed list |
| `marketplace.json` | Any HTTPS origin, including the shell origin | One marketplace feed with plugin entries |

The repository keeps the authoritative feed at
`marketplace/marketplace.json` and the default source list at
`marketplace/sources.json`. The deploy step copies them to
`dist/marketplace.json` and `dist/marketplace-sources.json`.

The shell resolves `marketplace-sources.json` against `document.baseURI` and
fetches feeds from the URLs it contains. Source URLs are absolute. There is no
runtime UI, workspace file, query parameter or `localStorage` key that can add,
remove or override a feed.

## 3. `marketplace-sources.json`

```json
{
  "schemaVersion": 1,
  "feeds": ["https://mode777.github.io/exo-editor/marketplace.json"]
}
```

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes | Must be `1`. |
| `feeds` | string[] | yes | 1-10 absolute `https` URLs, or `http://localhost`; no credentials, fragment, duplicate normalized URL or non-string entry. |

Unknown fields are rejected. The file is capped at 64 KiB. An invalid or absent
file disables catalog discovery; it does not disable installed-plugin management
or install by manifest URL. Missing and invalid are distinct states.

## 4. `marketplace.json`

```json
{
  "schemaVersion": 1,
  "id": "exo-official",
  "name": "Exo Plugins",
  "description": "Plugins published by the Exo Editor project.",
  "owner": {
    "name": "Exo Editor",
    "url": "https://github.com/mode777/exo-editor"
  },
  "homepage": "https://mode777.github.io/exo-editor/",
  "plugins": [
    {
      "name": "Exo Code",
      "manifest": "https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json",
      "description": "Monaco-based reference code editor built with @exo/plugin-sdk.",
      "version": "0.1.0",
      "publisher": { "name": "Exo" },
      "homepage": "https://mode777.github.io/exo-editor/",
      "license": "MIT",
      "keywords": ["code", "editor"],
      "category": "Editors"
    }
  ]
}
```

### 4.1 Envelope

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes | Must be `1`. Other versions are rejected, not guessed. |
| `id` | string | yes | `^[a-z0-9][a-z0-9-]{1,63}$`; stable marketplace identity. |
| `name` | string | yes | 1-80 characters; display name. |
| `description` | string | no | 1-500 characters. |
| `owner.name` | string | yes | 1-80 characters. |
| `owner.url` | string | no | Absolute `https` URL. |
| `homepage` | string | no | Absolute `https` URL. |
| `plugins` | array | yes | At most 500 entries, in display order. May be empty. |

### 4.2 Plugin entry

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `name` | string | yes | 1-80 characters; display name. |
| `manifest` | string | yes | Absolute `https` URL or `http://localhost`; no credentials or fragment. This is the install value. |
| `description` | string | no | 1-500 characters. |
| `version` | string | no | SemVer 2.0.0; display only, not an install pin. |
| `publisher.name` | string | no | 1-80 characters. |
| `publisher.url` | string | no | Absolute `https` URL. |
| `homepage` | string | no | Absolute `https` URL. |
| `repository` | string | no | Absolute `https` URL. |
| `license` | string | no | 1-40 characters. |
| `icon` | string | no | Absolute `https` URL. Loaded lazily without credentials or referrer; failure falls back to a shell icon. |
| `keywords` | string[] | no | 1-10 unique 1-32 character strings. |
| `category` | string | no | 1-40 characters. |

Unknown fields are rejected at every level. A feed is validated all-or-nothing:
one invalid entry rejects that feed, while other configured feeds remain usable.
The normalized `manifest` URL must be unique within a feed. An empty `plugins`
array is valid.

Display metadata is untrusted and non-authoritative. It is shown when a feed
loads and until a manifest is available. Once the manifest is fetched, installed
rows, consent and extension details use the manifest's name, id, version,
publisher, description, permissions and engine range. Feed metadata never
changes the consent fingerprint and never enters `exo.json`.

## 5. Loading

The shell fetches the source document and feeds lazily when the Extensions view
is first opened. It does not fetch marketplace documents on startup.

- Requests use `credentials: 'omit'`, no referrer, a 10-second timeout and a
  bounded body read.
- The source file is capped at 64 KiB. A feed is capped at 512 KiB.
- Feeds load in source order, concurrently up to the source limit. Catalog rows
  are flattened in source order and then entry order, and deduped by normalized
  manifest URL; the earlier feed wins.
- A failed feed shows its own error and retry. It does not block valid feeds,
  installed management or install by URL.
- The catalog is held in memory for the page session only. Reloading the page or
  disposing the runtime discards it. It is never written to IndexedDB,
  `localStorage`, `sessionStorage`, `exo.json` or a URL.
- A workspace switch does not reset the catalog because it belongs to the
  deployment, not the workspace. Installed state is re-read from the new
  workspace.

### 5.1 Issue vocabulary

| Code | Meaning |
| --- | --- |
| `network` | The request rejected on a same-origin URL or for a non-CORS reason. |
| `cors` | A cross-origin request rejected before a response; the browser does not expose the distinction from a network failure. |
| `timeout` | No response within 10 seconds. |
| `http-status` | A non-success response. |
| `too-large` | The body exceeded the source or feed byte cap. |
| `invalid-json` | The body is not strict JSON or has no JSON content type. |
| `invalid-sources` | The source document has the wrong shape, an invalid URL, a duplicate feed or an unknown field. |
| `invalid-feed` | The feed has the wrong shape, an invalid field value, a duplicate manifest URL or an unknown field. |
| `unsupported-version` | The document's `schemaVersion` is not `1`. |

Issues carry a JSON Pointer `field` when known and never include the document
body, a matched value or a stack trace.

## 6. Installing

An install writes exactly one entry:

```json
{
  "manifest": "https://plugins.example.com/monaco/exo-manifest.json",
  "enabled": true
}
```

Rules:

- The active workspace must be ready and writable, and `exo.json` must be valid
  or absent. With no workspace or in a read-only workspace, install is disabled;
  no file operation starts.
- The write goes through the shell-owned configuration store and the workspace
  session, with the loaded `ifVersion`, canonical 2-space JSON and a trailing
  newline.
- A manifest URL already in the declaration is not added twice. The shell reports
  the duplicate and points at the existing entry.
- Only `manifest` and `enabled` are written. Feed name, version, description,
  publisher, keywords and icon never enter `exo.json`.
- After the write, the plugin host loads the manifest and requests consent like
  any live add. No frame, registration or plugin code runs before approval.
- A failed install stays visible with its host failure and can be removed. The
  shell does not preflight the manifest; the host is the single validator.
- Disable, remove and revoke use the same dirty-document guard as the previous
  Settings surface.

Enabling, disabling and removing are simple declaration rewrites; they do not
copy or delete plugin files because the plugin is remote.

## 7. Surfaces

The **Extensions** activity-bar view owns discovery and management:

- one search field filters the Installed and Marketplace sections locally;
- Installed is derived from `exo.json` and the host snapshot, in declaration
  order;
- Marketplace is derived from the configured feeds, with the feed name shown as
  the source;
- a manifest URL already installed is marked and offers management instead of a
  second install;
- install by URL is available in the same view;
- clicking a row opens a shell-owned details tab with manifest metadata,
  permissions, contributions, runtime state, consent actions and declared
  settings.

The settings dialog keeps a **Plugin debugging** section with raw `exo.json`
editing, validation issues, runtime status and the plugin log. It no longer
offers add, enable, disable, remove, consent or contributed-setting controls.

## 8. Trust boundary

Feed content is untrusted display data:

- It is parsed as JSON, size-bounded and rendered as text or validated links. It
  is never passed to `dangerouslySetInnerHTML`, an iframe `src`, a `javascript:`
  URL, `eval`, a protocol message or a shell command.
- It cannot auto-install, auto-open, grant a permission or alter the consent
  fingerprint.
- The deployment's source list is trusted only to choose which feeds can appear
  in the catalog. A deployer who lists a hostile feed grants it display space,
  not installation or capability authority.
- A feed may list a manifest on any HTTPS origin. The normal consent prompt
  names that origin, root, permissions, globs and rendering.
- Feed documents and icons are fetched without credentials and without a
  referrer. Icons are optional and failure is non-blocking.
- The deployed shell contains no marketplace secret. The source file may be
  replaced at deploy time and is not a credential store.

## 9. Deployment

This repository deploys:

- `https://mode777.github.io/exo-editor/marketplace.json` — the authoritative
  feed, listing the deployed code plugin and template plugin;
- `https://mode777.github.io/exo-editor/marketplace-sources.json` — the default
  source list pointing at that feed.

`apps/shell/scripts/deploy-marketplace.mjs` validates both documents and copies
them into the shell artifact after the bundle-budget and plugin-copy steps. It
accepts `EXO_MARKETPLACE_SOURCES` and `EXO_MARKETPLACE_FEED` for an alternate
deployment. `check:marketplace` validates the built files. The source list is
deployment configuration, not application state.

## 10. Versioning

The marketplace feed has its own `schemaVersion`. It is independent of the shell
version, the plugin protocol major, the plugin manifest `schemaVersion` and the
SDK major. A new feed shape requires a new schema version and a validator; the
shell never silently ignores an unknown version.
