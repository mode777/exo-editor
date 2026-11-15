# Proposal

## Why

Layers 4-6 can load a plugin, open files through it and push events to it, but a
plugin still has no way to declare user-editable configuration. Layer 0 reserved
`contributes.configuration`, layer 6 reserved the `config/changed` topic and
`shell/init` already promises to carry settings values, yet the v1 validator
rejects the field and the event has no producer. Layer 7 activates the reserved
surface so a plugin can expose workspace-scoped options and the shell can render
them next to shell and workspace settings, without writing plugin state into
`exo.json` or giving one plugin another plugin's values.

## What Changes

- Activate `contributes.configuration` in the manifest with a strict v1 schema:
  a `properties` object of named settings, each with `type` (`boolean`, `string`
  or `number`), a required `default`, an optional `enum`, an optional
  `description`, and `scope` limited to `workspace` (omitted means workspace).
  Reject unknown fields, duplicate or mismatched enum values, a default outside
  its enum, more than 50 settings, and values that do not match their type.
- Add a shell-owned settings store keyed by the workspace identity and the
  plugin identity (`origin::id`), persisted in IndexedDB, never in `exo.json` or
  the workspace. Missing values use the manifest default; invalid stored values
  fall back to the default and are reported in the settings surface; switching
  workspaces detaches the store and a late load cannot leak into the next
  workspace.
- Render declared settings in the existing Plugins section with inputs suited to
  each type, validate edits against the manifest, persist on change, and show the
  plugin identity the values belong to. Values are shell state, so they remain
  editable in a read-only workspace.
- Carry the plugin's resolved settings in `shell/init` for both registration and
  editor frames, and publish `config/changed` with the full new value map to the
  live handler frames of that plugin only. Delivery still requires
  `events:subscribe`; no other plugin receives the values.
- Exclude configuration declarations from the consent fingerprint: a setting
  changes what the user can configure, not what the plugin is allowed to access.
  State this explicitly in the manifest contract so a future field is not
  mistaken for a capability.
- Extend the deployed fixture with declared settings, record init values and
  `config/changed` payloads, and document the manual checks. Update the manifest,
  protocol and events contracts, the JSON Schema and `ROADMAP.md`.

**Explicit non-goals:** machine/global or per-document settings, secrets or
credential storage, plugin-to-plugin settings, settings in `exo.json`, settings
sync across tabs, devices or workspaces, background frames, and configuration
types beyond boolean, string and number.

## Capabilities

### New Capabilities

- `plugin-settings`: shell-owned workspace-scoped settings storage, defaulting
  and validation, the settings surface for contributed configuration, isolation
  between plugins, persistence across reload and reset on workspace switch.

### Modified Capabilities

- `plugin-manifest`: activates `contributes.configuration` with its v1 schema and
  validation rules, removes the reserved-field rejection, and records that
  configuration declarations do not change the consent fingerprint.
- `plugin-protocol`: adds the resolved settings map to `shell/init` for
  registration and editor frames, without adding file content or a second
  initialization message.
- `plugin-events`: turns `config/changed` into a live per-plugin producer with
  full values, targeted to the named plugin's subscribed handler frames.

## Impact

- `apps/shell/src/plugins/manifest.ts`, `manifest.test.ts`: configuration types,
  parsing, limits and schema parity.
- `apps/shell/src/plugins/settings.ts` (new): settings types, validation,
  `PluginSettingsStore`, IndexedDB storage and memory test double.
- `apps/shell/src/plugins/host.ts`, `registration.ts`, `handler.ts`,
  `handlers.ts`, `events.ts`: declare configuration on manifest load, pass values
  into `shell/init`, and deliver targeted `config/changed`.
- `apps/shell/src/workspace/runtime.ts`, `context.tsx`: attach/detach the
  workspace settings store, expose the hook and reset on switch.
- `apps/shell/src/settings/PluginSettings.tsx`, `app.css`: settings inputs,
  validation messages and storage warnings inside the existing Plugins section.
- `apps/shell/public/plugin-host-fixture/`: declared settings, init and event
  observation, README checks.
- `docs/contracts/plugin-manifest.md`, `plugin-protocol.md`, `events.md`,
  `schema/exo.schema.json`, `ROADMAP.md`.
- No new dependency; the bundle budget is re-measured.
