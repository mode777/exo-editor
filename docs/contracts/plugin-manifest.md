# Plugin Manifest Contract (v1)

Status: draft - normative once the OpenSpec change `define-core-contracts` is
archived. Mirrored in
`openspec/changes/define-core-contracts/specs/plugin-manifest/spec.md`.

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
- Duplicate manifest URLs are rejected.
- `exo.json` is shell-only. No plugin message can read or write it. The settings
  UI rewrites it as canonical 2-space JSON; comments and formatting are not
  preserved (D8).
- A missing `exo.json` means "no plugins", not an error. A malformed one is
  surfaced as a workspace problem and no plugin is loaded.
- Plugin entries added after the workspace is ready are initialized immediately;
  removed entries are torn down immediately.

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
  "engines": { "exo": "^0.1.0" },
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
        "priority": 10
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
| `runtime.entry` | string | yes | Relative URL to the controller HTML document, loaded as a hidden registration iframe. Must share the manifest's origin. Its directory is the plugin root: every other page the plugin loads must be a sibling or descendant of it. |
| `permissions` | array | yes | Subset of `workspace:read`, `workspace:write`, `events:subscribe`. No duplicates. `workspace:write` implies `workspace:read`. |
| `contributes.fileEditors` | array | no | Maximum 20. Each entry: `glob` (required), `entry` (required, relative HTML URL for the per-document iframe, inside the plugin root), `label` (required, 1-40 chars), `priority` (integer -100..100, default 0). Every editor entry uses the entry-resolution rules in section 4. |
| `contributes.configuration` | object | no | Reserved for the plugin settings layer; rejected by the v1 validator until that layer is ratified. |

### Glob rules

- POSIX-style, `/`-separated, matched against the path relative to the workspace
  root without a leading slash.
- Supported syntax: `*`, `**`, `?`, character classes (`[abc]`, `[!abc]`), and
  brace alternation (`{ts,tsx}`). No negation, no extglobs, no regex.
- A glob may not start with `/`, contain `..`, contain NUL, be empty, or be
  longer than 200 characters.
- Overlapping registrations are allowed. When several plugins match a file, the
  shell picks the highest `priority`, then the earliest registration, and offers
  the others through "Open with...".

## 4. Entry resolution and the plugin root

Let `M` be the manifest URL after redirects and `C` the resolved controller entry
(`runtime.entry`). `C`'s directory is the **plugin root**. Two kinds of entry are
resolved with the same rules:

- **Controller entry** - `runtime.entry`, mounted once for the registration
  phase. It defines the plugin root.
- **Editor entries** - each `contributes.fileEditors[].entry`, mounted in a
  handler iframe when a matching file opens.

1. The entry is resolved against `M` (not against the declared URL).
2. The resolved entry must have the same origin as `M`.
3. The entry path must be inside the plugin root after dot-segment removal.
   Siblings of the controller entry and descendants of its directory are allowed;
   parents and unrelated directories are rejected. For example, with
   `runtime.entry = "plugin.html"`, `other.html` and `editors/code.html` are
   allowed while `../shared/plugin.html` is not.
4. The entry must be `https` (or `http://localhost` in development).
5. The entry origin **may equal the shell origin**. A same-origin plugin is
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
- 5 s timeout; 256 KiB response cap; `Content-Type` must be JSON-compatible.
- Redirects are followed, but the **final** URL defines the origin used for
  consent and for the entry-containment check. A redirect across origins is
  displayed as the final origin.
- The response is parsed as JSON and validated completely before any UI is shown
  beyond the loading row. Validation is all-or-nothing.
- Failures are reported per plugin with a stable code: `network`, `cors`,
  `timeout`, `http-status`, `too-large`, `invalid-json`, `invalid-manifest`,
  `unsupported-origin`, `unsupported-version`, `incompatible-engine`.
- The manifest is cached in memory for the session. It is never persisted as
  trusted data; consent is persisted separately (section 6).

## 6. Consent

Consent is required before the controller entry is mounted, and is requested
again whenever the capability surface widens. It is shown for every plugin,
including first-party plugins served from the shell origin.

### Displayed to the user

- Plugin `name`, `id`, `version`, `publisher.name` (verbatim, quoted).
- The **exact origin** the manifest was loaded from: scheme, host and port.
- The controller entry URL and the plugin root, plus each declared editor entry.
- The requested permissions in plain language.
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
    .map(e => ({ glob: e.glob, priority: e.priority ?? 0 }))
    .sort((a, b) => a.glob.localeCompare(b.glob) || a.priority - b.priority),
})))
```

`name`, `description`, `version`, `icon`, `publisher` and individual page paths
are excluded: they are display metadata or pages inside the already-approved
root. Changing the origin, the approved root, a permission or a declared glob
changes the fingerprint and re-prompts. Adding, removing or renaming a page
inside the root does not, because the user approved the directory tree (D14).

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
  newer shell is listed as incompatible rather than attempted.
- The protocol version is separate from both and is negotiated in the handshake
  (see [`plugin-protocol.md`](./plugin-protocol.md)).

## 8. Out of scope for v1

- Integrity hashes, signatures or publisher verification beyond displaying
  metadata.
- Automatic or background plugin updates.
- Marketplace discovery, ratings or install counts.
- Multiple manifests per plugin, or a plugin that declares another plugin.
- Contributions other than file editors and (later) configuration.
