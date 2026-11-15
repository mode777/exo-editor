# Design

## Context

See `proposal.md` for motivation and the delta specs for normative behavior.
The layer plugs into code that already exists:

- `apps/shell/src/plugins/manifest.ts` validates the whole manifest and currently
  rejects `contributes.configuration`; `schema/exo.schema.json` pins that
  rejection as `"configuration": false`.
- `PluginHost` (`plugins/host.ts`) fetches and validates manifests, assigns
  identity `${manifestOrigin}::${id}`, computes the consent fingerprint and
  drives registration. `PluginHostRecord` is what the settings UI already reads.
- `RegistrationSession` and `HandlerSession` both build `shell/init` from options.
  `HandlerSession` owns one handler frame; `HandlerPool` owns every handler frame
  for one workspace and the shared `EventBus`.
- `WorkspaceRuntime` owns the workspace-scoped stores (`pluginConfig`,
  `pluginHost`, `handlers`), attaches them in `activate`, and detaches them in
  `deactivate`. `handle.descriptor.id` is the shell's workspace identity.
- `PluginSettings.tsx` renders the Plugins section of the shell settings dialog
  and already has the plugin host snapshot, so it can render contributed settings
  without a new dialog.
- IndexedDB patterns already exist in `handle-store.ts` and
  `connection-store.ts`: one database, one object store, a promise-wrapped
  request, a memory store for tests.
- `EventBus.publish` currently broadcasts to every subscribed frame. It has no
  per-plugin targeting, which `config/changed` needs because the payload contains
  the plugin's values.

The layer is deliberately local: no workspace file, provider or protocol major
changes, no new dependency, and no second settings model next to `exo.json`.

## Goals / Non-Goals

**Goals:**

- A strict manifest declaration with deterministic defaults, limits and errors
  that the schema and the hand-written validator agree on.
- One shell-owned value store per workspace with a testable storage seam, clear
  resolution rules and no cross-plugin leakage.
- Settings inputs in the existing Plugins section that commit only valid values
  and explain default fallbacks and storage failures.
- `shell/init.settings` for both frame modes and targeted `config/changed` to the
  named plugin's subscribed handler frames.
- Deterministic reset/persistence across workspace switch and reload.

**Non-Goals:**

- Global or per-document scopes, secrets, provider credentials or values that
  affect shell permissions.
- Settings in `exo.json`, document tabs or workspace files.
- Cross-tab/cross-device synchronization, versioned value history, import/export
  or reset-all.
- Background frames, registration-frame subscriptions or a second config
  message.
- Configuration types beyond boolean, string and number; object/array settings
  would need their own schema and UI.

## Decisions

### D1 - `configuration.properties` is a map of named settings

```json
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
```

`properties` is required and holds at most 50 entries. A setting key is 1-64
characters matching `^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$`: lowercase first
character, then letters/digits, with single dots or dashes between segments. That
supports `fontSize`, `editor.fontSize` and `editor-font-size` without allowing
leading, trailing or repeated separators.

Each setting requires `type` (`boolean`, `string`, `number`) and a matching
`default`. Optional fields are `enum` (1-50 unique values of the same type,
containing the default; not allowed for booleans), `description` (1-500
characters) and `scope` (`workspace` only; omitted means `workspace`). Unknown
fields at the configuration or setting level invalidate the manifest.
`properties: {}` is valid and renders nothing. A string default or enum value is
at most 4096 characters, and numbers must be finite; this keeps one setting from
exceeding the event and message limits by itself.

Alternatives: a flat map is shorter but leaves no room for future configuration
metadata and lets a setting key collide with one. A VS Code-like `title` at the
configuration level adds display state the layer does not need; the key and
description are enough for v1. Supporting `integer`, `array` or `object` would
multiply the UI and validation surface without a roadmap consumer.

### D2 - Only user changes are persisted; defaults are derived

The store keeps the raw stored map and the resolved map separately. Resolution
is: a stored value that satisfies the current declaration wins; otherwise the
declared default. Defaults are never written back on load. That keeps a future
default change meaningful for users who never touched the setting and makes an
invalid stored value observable instead of silently replaced.

A user edit is validated against the declaration before it reaches the store. An
invalid edit returns a stable code and leaves both the active and stored values
unchanged. String values longer than 4096 characters and non-finite numbers are
invalid.

### D3 - Key by workspace identity plus plugin identity, in IndexedDB

`PluginSettingsStore` is keyed by `handle.descriptor.id` and, inside a workspace,
by `${manifestOrigin}::${id}`. It is a dedicated `exo-plugin-settings` database
(version 1, `settings` object store, workspace id as key) containing the raw
stored values only. The memory storage double is used by unit and runtime tests.

This follows the existing workspace identity and the manifest rule that consent,
settings and the registry key on the same identity. It also means two plugins
with the same `id` on different origins never share values, and a plugin cannot
address another plugin's record because no API accepts an arbitrary identity from
a frame.

Alternatives: a single localStorage blob is simpler but mixes settings with
machine-wide consent and has no workspace key; one IndexedDB record per identity
adds a compound key for no gain at 50 plugins; embedding values in `exo.json`
violates D11 and D8.

Known limitation: folder descriptors use `folder:<name>`, so two different
folders with the same name share a settings namespace, exactly as they share the
shell's other workspace identity. A provider-level stable id would be a separate
change.

### D4 - The manifest validator and JSON Schema stay in lockstep

`manifest.ts` gains `ManifestSetting`/`ManifestConfiguration` types, constants for
the limits and a `parseConfiguration` function. `schema/exo.schema.json` gains
`configuration`, `setting` and `settingKey` definitions with the same limits, and
`manifest.test.ts` extends its parity test to pin them. The parser returns the
existing `invalid-manifest` code with a JSON Pointer to the failing field, so
the consent UI and plugin log need no new error vocabulary.

Configuration is **not** part of the consent fingerprint. It declares values the
user edits in shell-owned state; it does not grant workspace, event or network
access. Adding it would re-prompt on a cosmetic settings change and would treat
configuration as a capability. The manifest contract and the consent requirement
state this explicitly so a future field cannot be mistaken for an oversight.

### D5 - `PluginSettingsStore` is runtime-owned and declares schemas as manifests load

```ts
type SettingValue = boolean | string | number
type SettingValues = Record<string, SettingValue>
type SettingIssue = { key: string; code: 'invalid-stored' | 'storage' }

class PluginSettingsStore {
  subscribe(listener): () => void
  getSnapshot(): PluginSettingsSnapshot
  attach(workspaceId: string): Promise<void>
  detach(): void
  declare(identity: string, configuration?: ManifestConfiguration): void
  values(identity: string): SettingValues
  set(identity: string, key: string, value: SettingValue): SetResult
}
```

`WorkspaceRuntime` constructs it with an `onChange` callback that forwards
`(identity, values)` to `HandlerPool.updateSettings`. `activate` awaits
`attach(descriptor.id)` before attaching `PluginHost` and `HandlerPool` so the
first `shell/init` already has stored values. `deactivate` calls `detach()` after
the handler pool and host are detached. A generation counter makes a late
IndexedDB read from a released workspace inert.

`PluginHost.finalize` calls `settings.declare(identity, manifest.configuration)`
when it assigns identity, before `beginRegistration`. A duplicate identity does
not declare. Re-enabling a plugin goes through the same path. A manifest that
fails validation never declares.

The store publishes a `PluginSettingsSnapshot` with `workspaceId`, per-identity
`values` and `issues`, a storage state (`ok`/`unavailable`) and a revision. The
React hook uses `useSyncExternalStore`, like the existing config and host hooks.

### D6 - Text and number commit on blur; boolean and enum commit immediately

The settings UI keeps a local draft for string and number inputs and writes to
the store on blur or Enter. Committing on every keystroke would persist partial
numbers and publish a `config/changed` event per character, which is noisy and
can hit the 100 events/s topic limit. Boolean checkboxes and enum selects have
discrete values and commit immediately. An invalid draft stays visible with an
inline error, while the active value remains unchanged.

Settings remain editable when the workspace is read-only: the values live in
shell storage, not in the workspace, and the plugin list's `Enabled` toggle
remains the only control gated by workspace writability. The block is shown only
when a validated manifest with configuration exists; a disabled plugin has no
manifest loaded, so it has no settings to render.

Storage failures do not block the workspace. A failed read starts from defaults;
a failed write keeps the in-memory value and sets the storage warning. The UI
shows "changes may not survive reload" rather than throwing.

### D7 - `shell/init.settings` is a top-level map

Both `RegistrationSession` and `HandlerSession` add `settings: SettingValues` to
`shell/init`, populated from `PluginSettingsStore.values(identity)`. The field is
always present and is `{}` when nothing is declared. It contains primitives only,
never file content, and no second initialization message is introduced.

`HandlerPool.attach` receives the store and passes the current map into each
`HandlerSession` at open time. `PluginHost` passes it into `RegistrationSession`
at start. A handler opened after a change gets the new values without an event.

### D8 - `config/changed` is targeted inside the existing event bus

`EventSink` gains an optional `identity`, set by `HandlerSession`. `EventBus.publish`
gains an optional `target` option: the topic sequence still increments once, but
only active subscribers with `sink.identity === target` and a subscription to the
topic are queued. `HandlerPool.updateSettings(identity, values)` finds the
plugin id from a live handler record and publishes
`config/changed { pluginId, values }` with `{ target: identity }`.

This preserves the event bus's sequence numbers, rate limiting, queues and
failure isolation, and it prevents another plugin's subscribed frame from
receiving another plugin's values. It also keeps the existing rule that
`events:subscribe` is required: a plugin without it gets current values only in
`shell/init` when a frame opens, and the settings UI states that changes apply on
reopen.

Alternatives: broadcast and let plugins filter leaks values to every subscriber;
a direct `postMessage` bypasses sequence, queue and limit handling and creates a
second push channel; storing per-plugin event topics would change the catalog.

### D9 - Fixture and documentation carry the observable surface

The deployed fixture manifest gains three settings (string, boolean, number
enum). `editor-common.js` records `payload.settings` in `shell/init` and updates
its recorded values when a `config/changed` event arrives; the existing events
editor already subscribes to all four topics. The fixture README gets the manual
steps for defaults, live change, reload persistence, workspace isolation and an
invalid stored value seeded through DevTools.

The normative text changes in `docs/contracts/plugin-manifest.md`,
`plugin-protocol.md` and `events.md`; the schema mirrors the manifest rules.
`ROADMAP.md` records the layer status and deployed evidence at completion.

## Risks / Trade-offs

- **Same-named folders share settings** → `folder:<name>` is the shell's existing
  workspace identity; do not try to invent a stronger id in this layer. Document
  it in the design and contract, and revisit only if the provider grows one.
- **A settings UI shown before consent could imply the plugin is trusted** → show
  settings only from a validated manifest and keep the existing consent state in
  the same row; values are not delivered until a frame mounts. The consent
  fingerprint intentionally does not change.
- **A future manifest field changes what the plugin can do but is forgotten in
  the fingerprint** → the contract's exhaustive-input sentence remains; this
  change adds an explicit counter-example for configuration and a test that
  adding configuration leaves the digest unchanged.
- **Large string values or frequent edits exceed event limits** → cap string
  values at 4096 characters and commit text/number on blur; config changes are
  user-driven and well below 100 events/s.
- **IndexedDB is unavailable or blocked** → defaults plus a session-only warning;
  no workspace or plugin frame is blocked. Covered by a memory storage that
  rejects reads and writes.
- **Cross-tab edits are not synchronized** → last write wins and each tab's
  in-memory view is authoritative for its own frames. Cross-tab sync is out of
  scope, consistent with the rest of the shell.

## Migration Plan

- No stored data migration: `exo-plugin-settings` is a new database and existing
  workspaces simply start from manifest defaults.
- Manifests that declared `contributes.configuration` were invalid before this
  layer, so no valid deployed manifest changes meaning. A manifest that adopts
  the field after rollout needs the new shell version in its `engines.exo` range.
- Deploy is the normal push to `main` through the `verify` and Pages workflows; no
  backend, proxy or secret is added.
- Rollback would re-reject the field and remove the producer. Plugins that
  adopted configuration would then fail validation, so rollback is forward-only
  in practice; record the deployed evidence before archiving.

## Open Questions

None. The configuration shape, fingerprint treatment, storage key and delivery
scope are decided above and reflected in the specs.
