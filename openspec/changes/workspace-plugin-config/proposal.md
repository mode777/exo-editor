# Proposal

## Why

Layer 2 gives the shell a real folder workspace, but it deliberately hides
`exo.json` and has no way to declare a plugin. Layer 3 makes plugin declaration a
validated, editable workspace artifact before any untrusted code exists: the
shell can list, add, enable, disable and remove entries, report problems per
entry, and rewrite the file canonically. Without it, layer 4 has nothing
trustworthy to load and the reserved-path rule has no real consumer.

## What Changes

- Add a strict, dependency-free `exo.json` parser and validator for
  `schemaVersion: 1`: exact root and entry shapes, unknown-field rejection, a
  50-entry limit, absolute `https` (or `http://localhost`) manifest URLs with no
  credentials or fragment, boolean `enabled` defaulting to `true`, and duplicate
  URL detection. Validation is all-or-nothing and reports stable codes with the
  failing entry index and field.
- Add a workspace-scoped plugin configuration store. It loads `/exo.json`
  through the shell side of the session when a workspace activates, treats a
  missing file as "no plugins", re-reads after shell writes and on
  focus/visibility, writes with `ifVersion` so a stale settings view cannot
  clobber an external edit, and drops late results after a workspace switch.
- Extend the settings surface with a Plugins section: the entry list with
  enabled state, add by manifest URL (URL validation only - no manifest fetch, no
  frame), enable/disable, remove, a raw `exo.json` view/editor, and one canonical
  rewrite path. The UI states that rewriting normalizes formatting and key order
  and that comments are not valid JSON.
- Route "Open Plugin Configuration" and any attempt to open `exo.json` to the
  settings section, never a document tab, and keep the explorer from offering the
  file as an editable document.
- Add fixtures and tests for missing, empty, malformed, partial-failure,
  over-limit, duplicate, read-only, stale-write and external-change workspaces,
  plus negative tests that plugin-originated access is denied while the shell can
  read and write the file.
- Update `docs/contracts/plugin-manifest.md`, its OpenSpec spec and the
  `editor-shell` spec with the normative load, refresh, error-code and rewrite
  rules. `schema/exo.schema.json` remains the shared shape; the hand-written
  validator pins its rules with a parity test instead of adding a runtime schema
  engine.

Not included: fetching or validating plugin manifests, consent, iframes, the
plugin registry, handler sessions, events, plugin settings, the SDK/template and
the Monaco plugin. Adding an entry in this layer records a URL; it loads nothing.

## Capabilities

### New Capabilities

None. Plugin declaration is already owned by `plugin-manifest`; the settings
surface is owned by `editor-shell`.

### Modified Capabilities

- `plugin-manifest`: adds the configuration load and refresh lifecycle,
  all-or-nothing validation with a stable per-entry error vocabulary, a read size
  cap, canonical rewrite semantics, and clarifies duplicate and over-limit
  handling.
- `editor-shell`: adds the plugin configuration settings surface, raw file
  access through settings, invalid and read-only states, the strict-JSON and
  formatting-normalization disclosure, and the rule that configuration never
  opens as a document or loads code.

## Impact

- New: `apps/shell/src/plugins/` for the validator, canonical writer and config
  store, plus plugin settings components.
- Changed: `SettingsDialog`, the runtime/context snapshot, commands, menus,
  `app.css`, tests and fixtures.
- Contract: `docs/contracts/plugin-manifest.md` gains the load, error-code and
  rewrite rules; `openspec/specs/plugin-manifest/spec.md` and
  `openspec/specs/editor-shell/spec.md` receive matching deltas.
  `docs/contracts/workspace-api.md` is unchanged; its existing reserved-path
  requirement already covers shell-versus-plugin access.
- No runtime dependency, backend or secret is added. The validator is
  hand-written against the shared schema and pinned by tests. The bundle budget
  is updated deliberately after measurement if needed.
- Layer 2's change is complete but still unarchived. Archive
  `workspace-provider` before archiving this change; this change does not modify
  `workspace-access` requirements.
