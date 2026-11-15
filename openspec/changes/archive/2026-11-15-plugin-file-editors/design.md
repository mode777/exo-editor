# Design

## Context

See `proposal.md` for motivation and `specs/plugin-file-editors/spec.md` for the
required behavior.

Current state that shapes this design:

- `PluginHost` already owns manifest validation, consent, registration frames,
  identity, the plugin log and an `EditorRegistry` whose `match(path)` returns
  ordered `EditorCandidate`s. Nothing consumes that list yet.
- `DocumentStore` owns every open document: it eagerly stats and reads the file,
  decodes UTF-8, owns dirty and save state, writes with `ifVersion`, and reacts to
  external changes. `WorkspaceSession.forPlugin(id)` already provides a facade
  that applies the reserved-path guard and logs denials; `write` already supports
  `ifVersion`; `onExternalChange` and `setOpenDocuments` already drive refresh.
- `FrameTransport` abstracts iframe creation and message routing for tests;
  `RegistrationSession` is the existing protocol state machine to mirror.
- The workbench preset renders only the active tab and recreates the document
  body on every tab switch. Tabs, the close guard and the unload warning are
  generic and already keyed by path.

## Goals / Non-Goals

**Goals:**

- Make a plugin editor a first-class document surface without weakening any
  existing shell guarantee.
- Keep file content flowing only from a live, id-addressed `plugin/request-file`.
- Keep the shell's text surface as the fallback for every non-plugin document.
- Make handler teardown deterministic on every path and testable without a
  browser.

**Non-Goals:**

- No protocol additions: the handler half of `plugin-protocol` is already
  ratified and is implemented as written.
- No persistent per-document editor choice, no editor preference settings.
- No event bus, plugin settings, SDK or reference plugin.
- No second, parallel document model: the existing `DocumentStore` stays the
  single source of truth.

## Decisions

### Handler lifecycle lives in a separate pool, not in `PluginHost`

A new `HandlerPool` (`apps/shell/src/plugins/handlers.ts`) owns handler frames,
keyed by document path. `WorkspaceRuntime` constructs it next to `DocumentStore`
and passes it a `PluginHost`-shaped source of candidates plus the active session.

- The host stays a fetch/consent/registration machine. Handler sessions are
  per-document and churn on tab open/close, which would bloat the host's queue
  state and tests.
- The host remains the authority on identity and permissions: `EditorCandidate`
  gains `pluginName`, `permissions`, `entryUrl` and `identity` (already present),
  so the pool never reaches into a manifest.
- `PluginHost` accepts an optional `handlerLifecycle` collaborator and calls
  `closeFor(identity, reason)` from `stopRecord` **before** dropping the registry
  entry. This covers disable, remove, revoke, duplicate identity and detach
  without the pool polling host snapshots.

Alternative considered: make `PluginHost` mount handlers itself. Rejected because
the host would then own both a workspace-scoped state machine and per-document
lifetime, and `DocumentStore` would need a host instance to save.

### `DocumentStore` gains an explicit surface, not a second store

`DocumentState` gains `surface: 'text' | 'plugin'` and an `editor` block
(`identity`, `pluginName`, `label`, `entryUrl`, `canWrite`). Status gains
`'plugin'` for a mounted handler and keeps `'error' | 'no-editor'` for fallback
states.

- `open(path)` stats first, asks the pool whether a candidate matches, and only
  then either mounts a handler (no content read) or takes the existing read/decode
  path. The stat is needed for metadata, size limits and `setOpenDocuments`
  regardless.
- Plugin-backed documents leave `text`/`savedText` empty; `dirty` is set only by
  `pool` callbacks. This keeps tab dots, the close guard, `hasDirty()` and the
  unload warning working without special cases in the UI.
- `save(path)` branches on `surface`: text keeps the current write; plugin asks
  the pool for content and writes it with the version the shell last delivered.
  The existing per-path save promise, abort controller and generation checks are
  reused, so a workspace switch still cancels writes.
- `reload(path)` for a clean plugin document disposes and remounts the handler; a
  dirty document keeps the existing "reload and discard" confirmation before
  remounting.
- `rename` remaps the document and asks the pool to re-key the session and
  forward `renamed`; `deleteUnder` disposes with `closed`/`removed` semantics.

Alternative considered: a separate `PluginDocumentStore`. Rejected: tabs, dirty
hooks, close prompts, rename/delete and `setOpenDocuments` are all keyed by path
in `DocumentStore`; a second store would duplicate them and risk divergence.

### Frames live outside the React tree

The preset unmounts the document body when the tab changes, so an iframe rendered
inside `DocumentArea` would be destroyed by a tab switch. The pool mounts every
handler through the existing `DomFrameTransport`, which appends hidden iframes to
a single body-level container. `DocumentArea` renders only the tab's chrome and
the notice states.

A hidden frame also matches the contract: a handler never renders shell UI, and
no plugin code shares the React root.

### Share the protocol plumbing between registration and handlers

Extract the envelope parse, message-size check, in-flight id bookkeeping, target
origin selection and violation counter from `RegistrationSession` into
`apps/shell/src/plugins/protocol.ts`. Both state machines then use one
implementation.

- Prevents the two frame lifetimes from drifting on the security-relevant parts
  (origin/source checks, opaque-origin identity, `*` only for opaque frames).
- Existing registration tests keep pinning the shared behavior; the handler tests
  pin the per-phase dispatch.
- `plugin/subscribe` and `plugin/unsubscribe` are legal editor-phase messages but
  their behavior belongs to layer 6. In this layer the shell replies
  `unsupported-message` and does not count a violation, so a probing plugin is
  not torn down.

### Reads reuse the session's plugin facade

The pool resolves the request, checks `workspace:read`, then calls
`session.forPlugin(pluginId)` for `stat`/`read`.

- The facade already enforces the reserved-path guard and records denials in the
  workspace log; re-implementing it in the pool would be a second guard to keep
  in sync.
- Normalization rejects `..` rather than repairing, so a relative request that
  escapes is rejected before the facade. A leading `/` is workspace-absolute; any
  other path joins the handler file's directory.
- A per-session cache keyed by path stores `{ version, bytes }`, is cleared on any
  external change for that path, and is never shared between plugins or
  workspaces. The first request always stats.

### Save is shell-initiated and serialized in the document store

The protocol has no plugin-initiated save; the shell always sends
`shell/request-save`. The document store already serializes saves per path and
holds the loaded version, so it drives the round trip:

- one live request plus at most one queued request per document;
- a 5 s timer per request, cleared on `plugin/save-content` or disposal;
- `plugin/save-content` accepted only with `replyTo` matching the live request,
  then written unchanged with `ifVersion`;
- on success the new version becomes the base version, and dirty clears only when
  the plugin has not reported `dirty: true` since the request was sent (tracked by
  a monotonically increasing dirty-report sequence);
- on `conflict`, `timeout`, `permission-denied` or `not-found`, the tab stays
  dirty, the error is surfaced in the document, and no retry loop starts.

### Selection is format-agnostic and permission-gated at registration

`workspace:read` (or `workspace:write`) is required for a file-editor
contribution; the registration session rejects otherwise with
`permission-denied`. `workspace:write` plus a writable session is required to
offer Save.

- The shell does not sniff or decode a file before selecting a plugin editor. The
  format is the plugin's concern; the shell's binary/oversized/undecodable
  verdict only applies to the text fallback. This is the point of a code or image
  editor and is recorded in the `editor-shell` delta.
- Candidate order comes from the existing registry; the pool takes the first
  eligible candidate. The remaining candidates are stored on the document for
  "Open with...".
- The 20-frame cap is counted per plugin identity in the pool (the registration
  frame is separate). Beyond the cap the document opens in the text surface with
  a notice; no 21st frame is created.

### "Open with..." is a per-document command

A command and tab context entry list the document's candidates with the current
one marked. Choosing another candidate disposes the current handler with `closed`
and mounts the chosen one in the same tab. The choice is not persisted and does
not change `exo.json`, the registry or other tabs.

### Teardown order is explicit

| Trigger | Order |
| --- | --- |
| Tab close | cancel save → `shell/dispose` (`closed`) → wait ≤1 s → remove frame → drop document |
| Plugin disable/remove/revoke | dirty prompt first → cancel saves → dispose handlers (`plugin-removed`) → close registration → drop registry |
| Workspace switch | cancel saves → dispose handlers (`workspace-switch`) → detach host → release session → clear documents |
| Handler failure | remove frame → mark the tab failed → keep other tabs and plugins untouched |

`DocumentStore.clear()` also asks the pool to dispose all handlers as a backstop,
so a future caller cannot release a session with live handler frames.

A plugin removal with dirty plugin-backed documents uses the existing close prompt
(Save/Discard/Cancel) before the settings action proceeds; the shell cannot
recover a plugin buffer once the frame is gone, and must not claim it was saved.

### Verification fixture

The deployed fixture's `editor.html` becomes a real handler: handshake, request
the file, echo it into the page, report dirty on a marker, answer save with
modified text, acknowledge dispose, and mirror state into `document.title` and
`#observation`. Behavior variants (dirty-on-open, save-with-extra-line,
never-ack) are chosen by path convention in the opened file's `shell/init`
metadata, so one fixture manifest can exercise read, repeated reads, dirty, save,
conflict and dispose-ack without a visible UI. Conflict is produced by editing the
file on disk outside the shell between open and save.

## Risks / Trade-offs

- **Hidden frames outlive React** → the pool is the only owner; `DocumentStore`
  and `Runtime.deactivate` both dispose, and tests assert the transport received
  `close` exactly once.
- **Two dirty sources of truth** → the store records only plugin reports; it never
  compares text, so a plugin that edits without reporting stays clean by design
  (documented in the spec).
- **Save prompt during plugin removal can fail** → the prompt stays open with the
  error, the plugin is not torn down until the user chooses discard or cancel.
- **Cache staleness** → every external change invalidates the path; the first
  request always re-stats; a version mismatch on save is a conflict, not a retry.
- **Frame cap counting drift** → the count is derived from the pool's live map,
  not a separate counter.
- **Bundle growth** → no new dependency; the handler pool and protocol extraction
  are measured against the existing budget and the number is updated deliberately.
- **Deployed verification depends on manual file edits for conflict** → the
  fixture path convention and the recorded steps make it repeatable; the unit
  suite covers the same path deterministically.

## Migration Plan

- No persisted data changes and no `exo.json` schema change; existing workspaces
  keep the text surface until a plugin registers a matching editor.
- Ship behind the normal `verify` gate; deploy to GitHub Pages with the rest of
  `main`. Rollback is a revert: frames disappear and documents fall back to the
  text surface, with no stored state to clean up.
- Consent fingerprints do not change in this layer.

## Open Questions

None that block implementation.
