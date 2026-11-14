# Design

## Context

Layer 2 delivered `WorkspaceRuntime`, the session, the explorer and the document
surface. The settings dialog is still layer 1's theme-only dialog, the explorer
filters `exo.json` out of every listing, and nothing parses the declaration. The
workspace contract already contains the rules this layer needs: `exo.json` is
shell-only, plugin access is denied by the session, writes support `ifVersion`
and reads support `maxBytes`.

Three constraints shape the implementation:

- `schema/exo.schema.json` is the shared shape for `exo.json`; the shell has no
  JSON Schema engine and adding one at runtime would spend bundle budget for a
  small, fixed subset.
- D8 requires a canonical 2-space rewrite. JSON does not permit comments, so
  the roadmap's "comments/formatting loss" warning must say that comments are
  invalid JSON rather than pretend to preserve or silently strip them.
- Layer 2's change is complete but unarchived. This design builds on its session
  and does not change `workspace-access` requirements; archive
  `workspace-provider` first.

## Goals / Non-Goals

**Goals:**

- One strict configuration module and one workspace-scoped store that layer 4 can
  consume without re-parsing or re-validating.
- A settings surface that is honest about missing, valid, invalid and read-only
  states, and that never turns `exo.json` into a document tab.
- Deterministic tests for validation, canonical bytes, refresh, stale writes and
  workspace-switch teardown.

**Non-Goals:**

- Fetching, validating or displaying plugin manifests; consent; iframes; the
  plugin registry or any plugin event.
- A comment-preserving or JSONC editor. v1 `exo.json` is strict JSON.
- Multi-file declarations, per-folder overrides or storing configuration outside
  the workspace.
- Changing the workspace provider or the session contract.

## Decisions

### D1. Validation is dependency-free and pinned to the shared schema

`src/plugins/config.ts` owns the types, constants, validator and canonical
writer. The validator walks the known `exoFile` shape instead of running a
generic JSON Schema engine:

- root must be a plain object; `schemaVersion` must be the number `1`;
  `plugins` must be an array of at most 50 entries;
- each entry must be a plain object with only `manifest` and optional `enabled`;
  `manifest` must be a string matching the v1 URL rules; `enabled` must be a
  boolean when present;
- duplicate manifest URLs are compared after `new URL(...).href` normalization so
  host casing and default ports cannot hide a duplicate;
- every issue is collected, not just the first, and the result is all-or-nothing.

The constants (`50`, `1`, the URL patterns, the 256 KiB cap) are declared next to
the validator and a unit test reads `schema/exo.schema.json` from disk and
asserts they agree with `$defs/exoFile`, `$defs/pluginEntry` and
`$defs/manifestUrl`. A schema change that is not mirrored fails the test. The
schema itself is not imported into the bundle.

Rejected alternatives: Ajv plus `ajv-formats` adds a runtime dependency and
code generation for a 50-entry file; importing the schema and introspecting it
at runtime becomes a fragile half-engine. String or AST patching for writes is
rejected for the same reason - canonical serialization from a validated value is
simpler and exact.

**Strict JSON.** `JSON.parse` is the parser, so comments and trailing commas are
`invalid-json`. The settings warning says comments are not part of the format and
that saving normalizes formatting and key order. This resolves D8's "comments"
wording without adding a JSONC parser or weakening the "invalid JSON disables
loading" rule.

### D2. One store lives for the runtime, sessions are attached and detached

`PluginConfigStore` is created once by `WorkspaceRuntime`, next to
`DocumentStore`. `attach(session)` increments a generation, resets the snapshot,
loads the file and installs focus/visibility listeners; `detach()` increments the
generation, aborts in-flight operations, removes the listeners and resets to
`idle`. Each operation captures the generation and an `AbortController`.
`WorkspaceRuntime` attaches after the new session exists and detaches before the
session is disposed, so a late read from the old workspace cannot publish into
the new one.

The store has a stable `subscribe`/`getSnapshot` pair, so settings use
`useSyncExternalStore(store.subscribe, store.getSnapshot)` without caring which
workspace is active. The configuration is deliberately not part of
`WorkspaceSnapshot`: a config edit should not rerender the explorer, tabs or
status bar. Layer 4 can subscribe to the same store; the "live add and remove"
initialization scenario remains layer 4 behavior, and this layer only publishes
the accepted declaration changes.

Store states:

```ts
type PluginConfigStatus = 'idle' | 'loading' | 'absent' | 'valid' | 'invalid'

interface PluginConfigSnapshot {
  status: PluginConfigStatus
  path: '/exo.json'
  version: string | null   // stat version used for ifVersion
  text: string | null      // exact current file text for the raw view
  entries: PluginConfigEntry[] // [] unless status === 'valid'
  issues: PluginConfigIssue[]
  busy: boolean            // a load, refresh or write is in flight
  revision: number
}
```

`load` and `refresh` coalesce through one in-flight promise. A refresh stats
first and skips the read when the version matches; this makes focus events cheap
and prevents rewriting state on every tab switch. A missing file is `absent`, not
an error. A `permission-denied`, `io` or `too-large` read failure is `invalid`
with `not-readable` or `too-large` and zero entries; the workspace itself stays
usable.

Writes are serialized behind the same in-flight promise. `mutate` and `saveRaw`
capture the generation, validate the next document, serialize it, and call
`session.write('/exo.json', bytes, { ifVersion, create })`. Existing files always
pass `ifVersion`; a mismatch becomes a `conflict` issue and triggers a refresh
without overwriting. A successful write installs a snapshot built from the bytes
just written and the returned version, so the UI never waits for a focus refresh.

Rejected alternative: create a new store per workspace. It would force every
subscriber to resubscribe on switch and make layer 4's subscription lifecycle
more complicated for no benefit.

### D3. Diagnostics are structured and never include file content

```ts
type PluginConfigErrorCode =
  | 'invalid-json'
  | 'unsupported-version'
  | 'invalid-config'
  | 'too-many-plugins'
  | 'duplicate-manifest'
  | 'too-large'
  | 'not-readable'
  | 'conflict'

interface PluginConfigIssue {
  code: PluginConfigErrorCode
  path: '/exo.json'
  field?: string      // JSON Pointer, e.g. /plugins/3/manifest
  entryIndex?: number // convenience for the row or issue list
}
```

The snapshot keeps `text` for the raw view, but issues never carry file bodies,
provider messages or stack traces. The settings surface renders
`code + entry + field`; the contract and spec use the same vocabulary, so layer 4
does not need a second translation table.

### D4. The canonical writer is the only writer

`serializeExoConfig(file)` builds a fresh value in fixed order and returns
`JSON.stringify(value, null, 2) + '\n'`:

```text
schemaVersion
plugins[]
  manifest
  enabled          // always explicit, including true
```

Structured operations (`addEntry`, `setEnabled`, `removeEntry`) start from the
last valid parsed document, change one thing, re-validate, serialize and write.
Raw save parses and validates the textarea first; invalid text is never written.
Because the writer always emits the same shape, an edit to an already-canonical
file changes only the targeted entry or flag. A non-canonical but valid file is
normalized on the first save, which is exactly what the warning describes.

A missing file is created with `create: true` and no `ifVersion`. There is no
exclusive-create operation in the provider contract, so a re-stat immediately
before the write narrows the race but cannot eliminate it; this is recorded as an
accepted, narrow risk. Once the file exists, every write is conditional.

On `conflict` the store refreshes its snapshot but does not clear the raw editor
text. The UI keeps the user's draft and offers an explicit reload, so a slow
external edit cannot silently discard typed content.

### D5. Settings is one surface with a plugins section, not a second editor

`SettingsDialog` keeps the theme section and gains a Plugins section rendered by
`src/settings/PluginSettings.tsx`. A `section` argument lets the command and any
future route open the dialog directly at `plugins`. The surface has four visible
states:

- **No workspace:** explanation and no workspace-dependent controls.
- **Absent:** empty state, add-by-URL input, raw view with the canonical empty
  declaration.
- **Valid:** entry rows with URL, enabled checkbox and Remove; add field; raw
  view.
- **Invalid:** issue list with code, entry index and field; structured controls
  disabled; raw editor available for repair; workspace still usable.

Read-only workspaces render the same data but disable add, toggle, remove and raw
save. The warning "Saving rewrites exo.json as canonical 2-space JSON. Comments,
formatting and key order are not preserved; comments are not valid JSON." is
always visible in the raw view and next to structured editing.

The raw editor is a plain labelled textarea with Save and Reload. It is not a
document tab, does not enter the preset tab store and cannot be reached by the
explorer. `PluginSettings` keeps draft text and a `dirty` flag; a clean draft
follows external refreshes, a dirty one is preserved and flagged. When the file
cannot be read at all (`not-readable`), the editor is disabled and the issue is
shown instead of pretending the file is empty. All controls
are disabled while `busy` is true; errors use `role="alert"` and status uses
`role="status"`.

### D6. Opening the declaration always routes to settings

The explorer continues to filter `/exo.json` and `/.exo/**` from every listing.
`WorkspaceRuntime.openDocument` gains a reserved-path guard: when the path is
`/exo.json` or under `/.exo/` (case-insensitive when the provider is), it calls an
injected `onReservedDocument` callback instead of opening a tab or a document.
`App` supplies a callback that opens settings at the plugins section. This makes
the negative test explicit: no tab is created even if a future quick-open or
command path tries to open the file.

A new command `exo.plugins.open` ("Open Plugin Configuration", Preferences) and a
Preferences menu entry call the same handler. The command is available without a
workspace so the surface can explain what to do.

### D7. Refresh, external edits and concurrency

The store installs `focus` and `visibilitychange` listeners on the injected event
target (the same object the session uses in production and tests). A refresh is
skipped while the document is hidden, while a write is in flight, or while a load
is already running. The stat version check prevents an external editor that only
touches the file from causing a re-parse.

If an external edit lands while the raw view is dirty, the store publishes the
new snapshot and the component keeps the draft; the banner says the file changed
on disk and offers Reload. If the user saves anyway, `ifVersion` produces
`conflict` and the same choice remains. Structured edits refresh the list
immediately after a successful write, so the next action sees the new version.

### D8. Contract and documentation changes

`docs/contracts/plugin-manifest.md` section 2 gains the normative load/refresh
rules, the 256 KiB cap, the issue vocabulary and shape, the canonical form, and
the clarification that `exo.json` is strict JSON and comments are invalid.
`docs/architecture.md` D8 gets the same clarification. `schema/exo.schema.json`
is unchanged. `docs/contracts/workspace-api.md` is unchanged: its reserved-path
requirement already allows shell access and denies plugin access.

The OpenSpec deltas mirror these rules in `plugin-manifest` and `editor-shell`.
No `workspace-access` delta is needed. On archive, update the layer 3 roadmap row
and the `AGENTS.md` current-state paragraph.

### D9. Tests are built around the store seam

- `config.test.ts`: table-driven valid/invalid fixtures, all issues collected,
  duplicate normalization, URL rules, entry limit, pointers, canonical golden
  bytes and a schema-parity check that reads `schema/exo.schema.json`.
- `store.test.ts` against the memory provider and an injected event target:
  attach/load, absent, invalid, external refresh, unchanged-version skip,
  oversize, read failure, stale write conflict, raw invalid save, workspace
  switch with a deferred late read, and attach/detach listener cleanup.
- `PluginSettings` integration with the existing App test harness: list, add,
  toggle, remove, missing, invalid, read-only, raw save, conflict, no-workspace,
  workspace switch, and an assertion that no `fetch` call or iframe appears.
- Security negative tests: the plugin facade is denied on `/exo.json` and
  `/.exo/**`, and `runtime.openDocument('/exo.json')` creates no tab and calls
  the routing callback. Removing the guard must fail the test.

## Risks / Trade-offs

- **Hand validator drifts from the schema** → the parity test pins every constant
  and shape the validator uses; the contract and spec are updated in the same
  change.
- **All-or-nothing disables every plugin on one typo** → deliberate contract
  behavior; the issue list names every failure and the raw editor is the repair
  path. Partial loading would make consent and teardown ambiguous.
- **Strict JSON rejects comments** → documented in the UI and contract; avoids a
  JSONC parser and keeps `invalid-json` honest.
- **Missing-file create race** → a re-stat narrows it; the provider contract has
  no exclusive create; layer 10 can revisit if it becomes a real problem.
- **Focus refresh races a write** → writes are serialized, refresh is skipped
  while busy, and `ifVersion` protects every existing file.
- **Bundle budget** → the validator and serializer are small; measure after
  implementation and update the committed budget deliberately if headroom moves.
- **Layer 2 is unarchived** → archive `workspace-provider` before archiving this
  change so the main specs receive both deltas in order.

## Migration Plan

No data migration. A workspace without `exo.json` stays "no plugins"; a valid
existing file is read as-is and only canonicalized when the user writes through
settings. The change ships through the normal `main` push and Pages deploy. A
rollback is a revert: `exo.json` remains a valid v1 file and no state is stored
outside the workspace.

## Open Questions

None. The remaining choices (exact button labels and CSS) do not change the
contract, the approach or the task breakdown.
