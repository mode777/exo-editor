# Plugin Manifest Contract (v1)

Status: ratified by the OpenSpec change `define-core-contracts`. Normative
requirements are mirrored in `openspec/specs/plugin-manifest/spec.md`. The
authoritative shape of both files is the shared JSON Schema at
[`schema/exo.schema.json`](../../schema/exo.schema.json); this document adds the
semantic rules a schema cannot express (duplicates, origins, containment,
engine compatibility).

## 1. Purpose

A workspace declares plugins in `exo.json`. Each entry points at a cross-origin
`exo-manifest.json`. The shell validates the manifest, shows it to the user with
the exact origin, and only then loads any code. The manifest is the complete
capability declaration; nothing is inferred from the entry page.

## 2. `exo.json`

Location: workspace root, exact name, case-sensitive where the provider is.

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "manifest": "https://plugins.example.com/monaco/exo-manifest.json",
      "enabled": true
    }
  ]
}
```

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes | Must be `1`. Unknown versions are reported, not guessed. |
| `plugins` | array | yes | May be empty. Maximum 50 entries. |
| `plugins[].manifest` | string | yes | Absolute `https` URL (or `http://localhost`). No credentials, no fragment. |
| `plugins[].enabled` | boolean | no | Default `true`. A disabled plugin is listed in settings and never loaded. |

Rules:

- Unknown top-level or entry fields are rejected, so a typo cannot silently
  disable a plugin.
- Duplicate manifest URLs are rejected. This is a semantic check across entries,
  not something the JSON Schema can express.
- `exo.json` is shell-only. No plugin message can read or write it. The settings
  UI rewrites it as canonical 2-space JSON; formatting and key order are not
  preserved (D8).
- `exo.json` is strict JSON. Comments and trailing commas are not valid and are
  reported as `invalid-json`; the shell does not strip them. A missing file means
  "no plugins", not an error. A malformed one is surfaced as a workspace problem
  and no plugin is loaded.
- Plugin entries added after the workspace is ready are initialized immediately;
  removed entries are torn down immediately.

### 2.1 Loading and refresh

The shell reads `/exo.json` through the shell side of the workspace session when
a workspace becomes ready. It refreshes its declaration state after every shell
write and on window focus or visibility. A refresh stats the file first and does
not re-read a version that was already loaded.

- A missing file is `absent`, not an error; it means zero plugins.
- The file is capped at 256 KiB. A larger file is `too-large` and yields zero
  usable entries.
- A permission or I/O failure is `not-readable` and yields zero usable entries.
  The rest of the workspace stays usable.
- A workspace switch resets the declaration before the new workspace is ready.
  A late read from the old workspace cannot update the new one.
- Loading or refreshing the declaration performs no network request to a
  manifest URL and creates no frame.

### 2.2 Validation is all-or-nothing

The complete file is validated against the `exoFile` branch of
[`schema/exo.schema.json`](../../schema/exo.schema.json) and the semantic rules
above before any entry is used. Every failure is collected and reported; one
invalid entry disables the whole declaration, so a valid sibling is never
partially loaded. The over-limit and duplicate cases are therefore errors with
zero usable entries, not truncation or partial acceptance.

An issue has this shape:

```ts
type PluginConfigIssueCode =
  | 'invalid-json'
  | 'unsupported-version'
  | 'invalid-config'
  | 'too-many-plugins'
  | 'duplicate-manifest'
  | 'too-large'
  | 'not-readable'
  | 'conflict'

interface PluginConfigIssue {
  code: PluginConfigIssueCode
  path: '/exo.json'
  /** JSON Pointer into the file when the problem belongs to a field. */
  field?: string
  /** Zero-based plugin entry index when the problem belongs to one entry. */
  entryIndex?: number
}
```

Issues never contain raw file content, provider messages or stack traces.

The shared schema does not change when the shell implements this validation. The
shell validator mirrors the `exoFile` branch, and a unit test reads the schema and
pins the constants and shape it relies on, so the two cannot drift silently.

### 2.3 Canonical rewrite

The shell writes `exo.json` only through the workspace session and only after
validation. The canonical form is 2-space JSON with:

- `schemaVersion` before `plugins`;
- `manifest` before `enabled` in every entry;
- `enabled` written explicitly, including `true`;
- one trailing newline.

The settings surface is the only writer. A rewrite of an already-canonical file
changes only the entry or flag the user edited. A valid but non-canonical file is
normalized on its first rewrite; the UI states that formatting and key order are
not preserved. Writes use the loaded stat version as `ifVersion`, so a stale
settings view fails with `conflict` rather than overwriting an external edit.

## 3. `exo-manifest.json`

```json
{
  "schemaVersion": 1,
  "id": "com.example.monaco",
  "name": "Monaco Code Editor",
  "version": "1.2.0",
  "description": "Source code editing for the Exo shell.",
  "publisher": {
    "name": "Example Corp",
    "url": "https://example.com"
  },
  "homepage": "https://example.com/monaco",
  "license": "MIT",
  "icon": "icon.png",
  "engines": { "exo": ">=0.1.0" },
  "runtime": {
    "entry": "plugin.html"
  },
  "permissions": ["workspace:read", "workspace:write", "events:subscribe"],
  "contributes": {
    "fileEditors": [
      {
        "glob": "**/*.{ts,tsx,js,jsx,json,css,md}",
        "entry": "editors/code.html",
        "label": "Code",
        "priority": 10,
        "rendering": "frame"
      }
    ]
  }
}
```

### Fields

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes | Must be `1`. |
| `id` | string | yes | `^[a-z0-9][a-z0-9.-]{2,63}$`, lowercase, stable across versions. Consent and settings key on it. |
| `name` | string | yes | 1-80 characters, displayed verbatim in consent and settings. |
| `version` | string | yes | SemVer 2.0.0. Informational; consent re-prompts when it changes only if the fingerprint changes. |
| `description` | string | no | Maximum 500 characters. |
| `publisher.name` | string | yes | 1-80 characters. |
| `publisher.url` | string | no | Absolute `https` URL. |
| `homepage` | string | no | Absolute `https` URL. |
| `license` | string | no | SPDX identifier. |
| `icon` | string | no | Relative to the manifest. `https` absolute also allowed. Rendered only after validation; failures are ignored. |
| `engines.exo` | string | yes | SemVer range. The shell refuses a plugin whose range excludes its version. |
| `runtime.entry` | string | yes | Relative HTML path to the controller document, loaded as a hidden registration iframe. No query, fragment or `..` segment. Must share the manifest's origin. Its directory is the plugin root: every other page the plugin loads must be a sibling or descendant of it. |
| `permissions` | array | yes | Subset of `workspace:read`, `workspace:write`, `workspace:list`, `events:subscribe`. No duplicates. `workspace:write` and `workspace:list` require `workspace:read`. A `contributes.fileEditors` entry requires `workspace:read` or `workspace:write`; registrations from a plugin without either are rejected with `permission-denied`. `workspace:list` additionally allows one directory level per `plugin/request-list` and re-prompts an already-approved reader when added. |
| `contributes.fileEditors` | array | no | Maximum 20. Each entry: `glob` (required), `entry` (required, relative HTML URL for the per-document iframe, inside the plugin root), `label` (required, 1-40 chars), `priority` (integer -100..100, default 0), `rendering` (`"hidden"` or `"frame"`, default `"hidden"`). Every editor entry uses the entry-resolution rules in section 4 and requires `workspace:read` or `workspace:write`. |
| `contributes.configuration` | object | no | Optional workspace settings declaration. `configuration.properties` is an object of at most 50 named settings, each with `type` (`boolean`, `string` or `number`), a required matching `default`, an optional `enum`, an optional `description`, and an optional `scope` that must be `workspace`. See section 3.1. |

Unknown manifest fields are rejected at every level, like unknown `exo.json`
fields. A field added by a future schema version requires that version and a new
validator; it is never ignored in v1.

### 3.1 Contributed configuration

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "editor.fontSize": {
          "type": "number",
          "default": 13,
          "description": "Font size in pixels."
        },
        "editor.theme": {
          "type": "string",
          "enum": ["auto", "dark", "light"],
          "default": "auto",
          "scope": "workspace"
        }
      }
    }
  }
}
```

`configuration` is optional. `properties` is required and holds at most 50
settings. Each key is 1-64 characters matching
`^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$`: a lowercase first character, then
letters or digits, with single dots or dashes between segments. Unknown fields at
the configuration or setting level make the manifest invalid.

Each setting has:

| Field | Required | Rules |
| --- | --- | --- |
| `type` | yes | `boolean`, `string` or `number`. |
| `default` | yes | Must match `type`. A string is at most 4096 characters; a number must be finite. |
| `enum` | no | 1-50 unique values of the same type, containing `default`. Not allowed for `boolean`. |
| `description` | no | 1-500 characters. |
| `scope` | no | Must be `workspace`; omission means `workspace`. |

`properties: {}` is valid and declares no settings. A string default or enum value
longer than 4096 characters and a non-finite number are invalid.

Configuration declares values the user edits in shell-owned state. It is not a
capability: it does not grant workspace, event or network access and it is
**excluded from the consent fingerprint**. Values are stored by the shell keyed by
workspace and plugin identity (D11); they are never written to `exo.json` or the
workspace. The settings UI and delivery rules are in
[`plugin-settings`](../../openspec/specs/plugin-settings/spec.md) and
[`plugin-protocol.md`](./plugin-protocol.md).

### Editor rendering

`rendering` selects how the shell presents a handler frame; it is not a new
capability and never changes the sandbox or origin rules.

- `"hidden"` (the default) keeps the handler headless. The shell owns the visible
  document surface and the plugin reports content only through the protocol.
- `"frame"` asks the shell to display the handler iframe in the measured document
  area for the active tab. The tab strip, breadcrumbs, Save action and shell
  notices stay outside the frame. The frame is hidden, not disposed, while another
  tab is active.

The value is manifest metadata: no `plugin/register` message carries it, and the
shell ignores a registration that tries to change it. A hidden-to-frame change
re-prompts because frame rendering is included in the consent fingerprint below.

### Glob rules

- POSIX-style, `/`-separated, matched against the path relative to the workspace
  root without a leading slash.
- Supported syntax: `*`, `**`, `?`, character classes (`[abc]`, `[!abc]`), and
  brace alternation (`{ts,tsx}`). No negation, no extglobs, no regex.
- A glob may not start with `/`, contain `..`, contain NUL, be empty, or be
  longer than 200 characters.
- Each `glob` may be declared at most once in `contributes.fileEditors`. Two
  contributions with the same `glob` make the manifest invalid, so a registered
  glob has exactly one priority and one default label.
- Overlapping registrations are allowed. When several plugins match a file, the
  shell picks the highest `priority`, then the earliest registration, where
  "earliest" means the earlier enabled entry in `exo.json` and then the earlier
  registration message within that plugin. The choice therefore does not depend
  on fetch or handshake completion order. The other matches are offered through
  "Open with...".

## 4. Entry resolution and the plugin root

Let `M` be the manifest URL after redirects and `C` the resolved controller entry
(`runtime.entry`). `C`'s directory is the **plugin root**. Two kinds of entry are
resolved with the same rules:

- **Controller entry** - `runtime.entry`, mounted once for the registration
  phase. It defines the plugin root.
- **Editor entries** - each `contributes.fileEditors[].entry`, mounted in a
  handler iframe when a matching file opens.

1. A declared entry must be a relative HTML path with no query string, no
   fragment and no `..` segment. Registration entries are checked the same way
   after resolution; a declared entry that already contains `..` is invalid, not
   normalized.
2. The entry is resolved against `M` (not against the declared URL).
3. The resolved entry must have the same origin as `M`.
4. The entry path must be inside the plugin root after dot-segment removal.
   Siblings of the controller entry and descendants of its directory are allowed;
   parents and unrelated directories are rejected. For example, with
   `runtime.entry = "plugin.html"`, `other.html` and `editors/code.html` are
   allowed while `../shared/plugin.html` is not. Percent-encoded dot segments
   (`%2e`, case-insensitive) are rejected in the declared and resolved path even
   though they survive URL normalization, because a server may decode them after
   the browser has removed literal `..` segments.
5. The entry must be `https` (or `http://localhost` in development).
6. The entry origin **may equal the shell origin**. A same-origin plugin is
   mounted with the stricter sandbox (`allow-scripts`, no
   `allow-same-origin`), so it runs in an opaque origin: no storage, cookies or
   parent DOM. A cross-origin plugin keeps `allow-same-origin` and its own
   storage. Consent is shown either way (D3, D9).

After consent, the plugin may load any HTML document inside the plugin root
without a new prompt. That covers additional editor pages added in a later
release, as long as they stay inside the approved root. Loading a page outside
the root is rejected before the browser sees the URL. Consent therefore covers a
directory, not a fixed list of pages (D14).

Assets referenced by a plugin page - scripts, styles, workers - are the plugin's
business and may be cross-origin. They load inside the iframe under its own
origin and CSP, not the shell's.

## 5. Fetch and validation

- `fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow',
  referrerPolicy: 'no-referrer' })`.
- 5 s timeout; 256 KiB response cap; `Content-Type` must be JSON-compatible
  (`application/json` or another `+json` media type). A missing or non-JSON type
  fails with `invalid-manifest` before parsing.
- Redirects are followed, but the **final** URL defines the origin used for
  consent and for the entry-containment check. A redirect across origins is
  displayed as the final origin.
- The response is parsed as JSON and validated completely before any UI is shown
  beyond the loading row. Validation is all-or-nothing.
- Failures are reported per plugin with a stable code: `network`, `cors`,
  `timeout`, `http-status`, `too-large`, `invalid-json`, `invalid-manifest`,
  `unsupported-origin`, `unsupported-version`, `incompatible-engine`. These are
  the codes the consent UI and the plugin log display; they never include raw
  response bodies or stack traces.
- Browsers reject a CORS failure and a network failure with the same `TypeError`.
  A cross-origin request that rejects before a response is therefore reported as
  `cors`, and its message names the origin and says that a network failure is
  possible. A same-origin rejection is `network`; `timeout` is reserved for the
  five-second limit and `http-status` for a non-success response.
- The manifest is cached in memory for the session. It is never persisted as
  trusted data; consent is persisted separately (section 6).

## 6. Consent

Consent is required before the controller entry is mounted, and is requested
again whenever the capability surface widens. It is shown for every plugin,
including first-party plugins served from the shell origin.

### Identity

A plugin's identity is `${manifestOrigin}::${id}`, using the final origin after
redirects. Consent records, settings and the runtime registry key on it. Two
entries in one workspace may resolve to the same identity only if they are the
same plugin: the shell loads the earlier declaration and reports the later entry
as `duplicate-identity`, with no consent prompt and no frame. The same `id` on a
different origin is a different plugin.

### Displayed to the user

- Plugin `name`, `id`, `version`, `publisher.name` (verbatim, quoted).
- The **exact origin** the manifest was loaded from: scheme, host and port.
- The controller entry URL and the plugin root, plus each declared editor entry.
- Whether each editor renders its own frame or stays headless.
- The requested permissions in plain language, including directory listing as
  permission to list folder contents and file names in the workspace, including
  files the plugin has not opened.
- The declared file-editor glob patterns and labels.
- Whether the plugin can write to the workspace.
- Whether the plugin shares the shell origin. In that case the dialog states that
  it runs without storage access and cannot be isolated by origin.
- A link to `homepage` when present.

The dialog must not summarize the origin as a name, logo or domain suffix only.
It shows the URL text the browser used.

### Fingerprint

```ts
fingerprint = "v1:" + hex(sha256(JSON.stringify({
  id,
  entryOrigin,
  // Absolute path of the approved directory tree, not individual pages.
  root: pluginRootPath,
  permissions: [...permissions].sort(),
  fileEditors: contributes.fileEditors
    .map(e => ({
      glob: e.glob,
      priority: e.priority ?? 0,
      ...(e.rendering === 'frame' ? { rendering: 'frame' } : {}),
    }))
    .sort((a, b) => a.glob.localeCompare(b.glob) || a.priority - b.priority),
})))
```

`name`, `description`, `version`, `icon`, `publisher` and individual page paths
are excluded: they are display metadata or pages inside the already-approved
root. The `rendering` flag is included only when it is `"frame"`, so existing
hidden manifests keep their stored consent and a hidden-to-frame change
re-prompts. Changing the origin, the approved root, a permission or a declared
glob changes the fingerprint and re-prompts. Adding, removing or renaming a page
inside the root does not, because the user approved the directory tree (D14).
The input list is exhaustive: a new manifest field that changes what the plugin
can do must be added to the fingerprint in the same change, or consent would
silently cover behaviour the user never saw. `workspace:list` is a separate
permission for this reason: a plugin that previously declared only
`workspace:read` gains a different sorted permissions input when it adds listing,
so it re-prompts, while a read-only plugin keeps its stored consent.

### Storage

`localStorage["exo.consent.v1"]` holds one JSON object:

```ts
type ConsentStore = Record<string, ConsentRecord> // key: `${manifestOrigin}::${pluginId}`

interface ConsentRecord {
  manifestOrigin: string
  pluginId: string
  manifestUrl: string
  version: string
  fingerprint: string
  grantedAt: string // ISO 8601
}
```

- Consent is machine-wide, not per workspace (the user consents to an origin, not
  to a folder).
- A record with a different fingerprint is treated as absent and re-prompted;
  the old record is replaced only on approval.
- "Deny" is remembered for the session and re-asked on the next load; it is not
  persisted. Revoking a stored consent removes the record and tears down the
  plugin immediately.
- The store is namespaced by key; a malformed store is discarded, not repaired.

## 7. Versioning

- `schemaVersion` is the manifest format version. The shell accepts exactly `1`
  in this release. A future version requires a new OpenSpec change and a consent
  UI that can explain new fields.
- `engines.exo` is checked against the shell version. A plugin that requires a
  newer shell is listed as incompatible rather than attempted. A manifest that
  uses `workspace:list` should set a range that includes a listing-capable shell;
  the shell checks `engines.exo` before the permission vocabulary, so an older
  shell reports `incompatible-engine` instead of rejecting a correctly versioned
  plugin as `invalid-manifest`.
- The protocol version is separate from both and is negotiated in the handshake
  (see [`plugin-protocol.md`](./plugin-protocol.md)).
- The SDK does not parse, validate or rewrite a manifest, and it does not infer
  capabilities from `engines.exo` or the shell version. Its compatibility policy
  is in [`plugin-sdk.md`](./plugin-sdk.md#9-compatibility-and-deprecation-policy).
- The release communication plan and the breaking-change upgrade-note rule are
  in [`releases.md`](../releases.md).

## 8. Out of scope for v1

- Integrity hashes, signatures or publisher verification beyond displaying
  metadata.
- Automatic or background plugin updates.
- Marketplace discovery, ratings or install counts.
- Multiple manifests per plugin, or a plugin that declares another plugin.
- Contributions other than file editors and configuration.
