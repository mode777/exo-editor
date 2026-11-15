# Design

## Context

`WorkspaceRuntime` currently hardcodes `FolderWorkspaceProvider`, gates `start()`
and `openFolder()` on `supportsFolderWorkspaces()`, and stores exactly one
IndexedDB record (a `FileSystemDirectoryHandle`). Sessions, the explorer,
documents and the plugin host only see `WorkspaceSession`, so a second provider
needs no change below `runtime.ts`.

`@stratofold/client` 0.11.0 shipped on npm (verified 2026-11-15 against the
published tarball, not just the repository): zero runtime dependencies, ISC, ESM
with types, `sideEffects: false`. Its real surface matters for the design:

- `new StratofoldClient({ baseUrl, vdir, token?, fetch?, createXhr? })` — `vdir`
  is **required and validated** at construction; `tokenInfo()` hits
  `/api/sf/tokens/me` and is the only method that does not use `vdir`.
- `list(path)` → `{ name, size, dir, modtime, version }[]`, one level;
  `stat(path, { signal })` → `{ path, name, kind, size, mtime, version }`;
  `read(path, { signal, headers })` → raw `Response`; `upload(path, body, {
  signal, ifVersion, onProgress })`; `mkdir`, `move`, `remove` take no signal.
- `UploadBody` is `Blob | File | ArrayBuffer`, not `Uint8Array`; `ifVersion` is an
  unquoted strong version or `"*"`; a 412 rejects with `StratofoldError` carrying
  `kind: "conflict"` and an optional `version`; 401/403 are `unauthorized` /
  `forbidden`; uploads use XHR behind an injectable `createXhr`.

The deployed CSP already allows `connect-src https: http://localhost:*`, so no
policy change is needed. See `proposal.md` for motivation and the specs for
requirements.

## Goals / Non-Goals

**Goals:**

- Add a second provider kind without weakening the existing contract, the
  single-access-path rule or the folder path.
- Keep the credential out of every surface the remote path touches: URLs,
  bundles, logs, DOM attributes and plugin messages.
- Make failure states explicit: an unreachable server, a wrong token, a revoked
  token and a public directory are four distinguishable outcomes.
- Prove the adapter with the existing conformance suite plus the Stratofold edge
  cases, using the client's own injection seams.

**Non-Goals:**

- A new provider method, protocol message or `WorkspaceSession` member.
- Token refresh, OAuth, a proxy or a backend of any kind.
- Background sync, offline mode, file watching or multi-root.
- Second remote provider implementation; only the seams that make one possible.

## Decisions

### 1. Adapter is a provider, not a new layer

`StratofoldWorkspaceProvider` implements `WorkspaceProvider`/`WorkspaceHandle`
and lives in `apps/shell/src/workspace/providers/stratofold/`, matching the
folder provider's file split: `provider.ts` (adapter), `errors.ts` (mapping),
`connection.ts` (validation/discovery), `connection-store.ts` (persistence),
`fake-server.ts` (test double).

Alternatives: a generic "remote provider" abstraction with Stratofold as a
config (premature — one implementation, no second use case); extending
`WorkspaceProvider` with credential or reconnect methods (contract change for
shell-only concerns).

### 2. Provider selection is a registry in the runtime

`WorkspaceRuntime` gets a provider registry entry per kind (`kind`, `label`,
`isAvailable()`, `create()`, `restore()`), and the existing `providerFactory`
option becomes a factory that can create either kind. A persisted marker
(`{ kind }`, `exo-workspace` database, new `state` store) says which provider's
stored record to restore. A pre-existing handle record with no marker is treated
as `folder`, so current users keep their restored workspace.

`openFolder()` keeps its signature; a new `connectRemote(request)` validates,
creates the adapter and calls the same `activate()` path. Both share the existing
teardown, so tabs, documents, plugin host, plugin config and the generation
counter reset exactly once.

Alternatives: one provider that multiplexes both backends (breaks the
one-provider-per-workspace identity the descriptor and restore logic assume);
branching on `providerKind` inside `activate()` (second way to do the same thing).

### 3. Discovery uses a sentinel-vdir client; the form asks for URL and token

The connect form takes a server URL and a token (editor or viewer) and nothing
else. Discovery constructs a throwaway client with `vdir: ""`-avoiding sentinel
(`"-"`), calls `tokenInfo()`, and then builds the real client from
`info.vdir.id`. The sentinel client performs exactly one request, `/api/sf/tokens/me`,
and every later operation goes through the rebuilt client. A test asserts that
the sentinel client issues no other request.

Alternatives: requiring the user to type the vdir id (the token is already bound
to one directory; asking duplicates the scope and turns a mistyped id into a
confusing 404); calling `/api/sf/tokens/me` with a hand-rolled `fetch` (a second
auth implementation).

The sentinel relies on 0.11.0 validating only that `vdir` is a non-empty string.
The dependency is pinned exactly, a test fails if that changes, and the upstream
ask is to make `vdir` optional for discovery.

Public mode is different: there is no token, so discovery is impossible. The form
takes a server URL and a directory id, then validates with `list("")` and mounts
read-only.

### 4. Capabilities and identity

`writable` is `role === "editor"` (never for a public connection); `watchable` is
`false` (session re-stats open documents on focus, as with the folder provider);
`persistent` reflects whether the user opted to remember the connection;
`caseSensitive` is `false` (the server does not expose it, so `EXO.JSON` and
`.EXO/**` must be treated as reserved); `maxFileSize` is omitted because the
server's limit is not discoverable.

The descriptor id is a non-secret digest of provider kind, server origin and
directory id, so two Stratofold workspaces on one server stay distinguishable
without embedding the token.

### 5. Version, conflict and creation semantics follow the existing contract

- `stat`/`ls` supply the version; Exo treats it as opaque.
- `write(ifVersion)` → `upload(..., { ifVersion })`. A `conflict` rejects as
  `WorkspaceError('conflict')`; the adapter then re-stats so the shell can refresh
  the open document's version through the existing refresh path. The error type
  gains no new field.
- `write` with `create: false` pre-stats the target and rejects `not-found` when
  it is missing, mirroring the folder provider; `create: true` creates missing
  parents with `mkdir` first.
- Writing to the root or to a directory pre-stats and rejects `not-a-file`.
- `mkdir` pre-stats target and parent (`already-exists`, `not-a-directory`,
  `not-found`), `remove` pre-stats and pre-lists for `recursive: false`, `move`
  pre-stats source and destination (rejecting `already-exists` when `overwrite` is
  false) and stats the destination afterwards.
- `mtime` converts the server's RFC3339 string to epoch milliseconds; directories
  report `size: 0`.

### 6. Reads enforce `maxBytes` before and after the transfer

`read` stats first (directory → `not-a-file`, missing → `not-found`), rejects
`too-large` when `size > maxBytes`, checks `Content-Length` when present, then
checks the actual byte length after `arrayBuffer()`. The body is copied into a
fresh `Uint8Array`, matching the folder provider's isolation (mutating the
result cannot affect the cache or the next read). Aborts map to `aborted` when
the caller's signal fired, `io` otherwise.

### 7. Cancellation is honest where the client allows it

`stat`, `read` and `upload` receive the caller's signal. `list`, `mkdir`, `move`
and `remove` have no signal in 0.11.0, so the adapter races the promise against
the signal and rejects `aborted` immediately; the remote mutation may still
land. That residual is documented in `docs/providers/stratofold.md`, and the
runtime's generation counter already drops late results after a switch.

### 8. Credential lifecycle

- The token lives in the adapter's client instance and never in a DOM attribute,
  a URL, a log entry or the workspace log (`WorkspaceLogEntry` has no free-text
  field, and nothing new is added).
- Default is session-only: the request lives in memory and a reload forgets it.
- "Remember this connection" writes `{ server, vdir, name, role, token }` to the
  `exo-workspace` database (`connections` store, key `last`). The UI states that
  the token is stored in this browser and that forgetting deletes it.
- Forgetting, disconnecting or a failed reconnect deletes the record; a failed
  *connect* never writes one.
- Redaction tests assert the token never appears in a request URL, a log entry, a
  snapshot exposed to React, or a message posted to a plugin frame.

Alternatives: `sessionStorage` (lost on reload, so "remember" is impossible);
`localStorage` (JSON-only rule is satisfiable, but IndexedDB is the established
store and the token should not sit in a synchronous, widely-read store).

### 9. Reconnect is a shell state, not a provider method

The adapter accepts an `onCredentialRejected` constructor callback and calls it
when a Stratofold failure is `unauthorized`/`forbidden`. Only real HTTP
denials reach the adapter; containment and reserved-path denials happen in the
session before the provider, so this callback cannot fire for them.

The runtime records `remote: { phase: 'rejected', name }` in its snapshot, keeps
the session mounted read-only, and renders a banner with "Reconnect" and
"Disconnect". Reconnect re-runs the connect flow and, on success, performs a
normal switch (dirty-document guard first, then teardown and activate), so no
cached tab, content or version crosses the reconnect. Disconnect is the existing
dispose path plus "no workspace".

Alternatives: adding a `onAuthFailure` provider method or session member (contract
change); polling `tokenInfo()` on a timer (background requests the user did not
ask for, and the spec forbids further requests in the rejected state).

### 10. UI surface reuses the settings dialog

A "Workspace" section in `SettingsDialog` shows the active provider, the
connection (server and directory name, never the token), the remember/forget and
disconnect actions, and the reconnect action when rejected. Commands:
`exo.workspace.connectRemote` ("Connect Remote Workspace…") and
`exo.workspace.disconnect`. The empty-editor and unsupported states point at the
remote-connect command, which satisfies the modified unsupported-browser
requirement without a new page.

### 11. Tests use the published client, not a re-implementation

A deterministic fake Stratofold server implements `ls`, `stat`, `/files`,
`upload`, `mkdir`, `mv`, `rm` and `tokens/me`, injected through `fetch` and
`createXhr`. `runProviderConformance('stratofold', …)` runs against it, plus the
edge cases: same-size same-second save rotating the version, stale `ifVersion`
→ `conflict`, rename onto an existing file without `overwrite`, non-recursive
remove of a non-empty directory, abort/dispose, directory `read`, missing path,
`EXO.JSON` reserved under `caseSensitive: false`, and no token in any request
URL. Runtime tests cover provider selection, restore by kind (including a marker
written by an older build), cross-provider switching, and the reconnect
transition.

### 12. Documentation and roadmap are part of the change

`docs/providers/stratofold.md` records the publication, the real 0.11.0 surface,
the discovery decision and the residual gaps; `ROADMAP.md` P1 moves from blocked
to landed-in-parallel with the npm exit criterion checked; `docs/architecture.md`
D17 keeps its decision text and gains the credential-storage consequence.

## Risks / Trade-offs

- **Deployed verification needs a real Stratofold instance.** A local fake server
  is unit-test evidence only. → Use a real HTTPS vdir for the deployed checks
  (connect, browse, open, save, reload/restore, revoke, viewer/public read-only);
  if no instance is reachable, keep the acceptance task open rather than
  substituting a local dev build.
- **Token at rest is XSS-readable.** → Opt-in only, stated in the UI, deletable,
  and never readable through a plugin frame or the workspace log.
- **`list`/`mkdir`/`move`/`remove` cannot be cancelled remotely.** → Reject
  `aborted` locally and rely on the generation counter; a mutation can land after
  a switch, which is documented.
- **Discovery depends on the sentinel-vdir constructor behaviour.** → Exact pin,
  a test that asserts a single `tokens/me` request, and an upstream ask.
- **`caseSensitive: false` hides a legitimate `EXO.JSON`.** → Accepted; the
  server exposes no case-sensitivity capability, and conservative denial is the
  safe direction.
- **Same-size external edit in the same second is invisible.** → Stratofold's
  documented residual; the provider document states it instead of claiming live
  watching.
- **Bundle budget grows with the client.** → Measure the real gzip delta; raise
  the `js` limit only with the measured number recorded, never silently.
- **Reconnect clears tabs.** → Accepted: it is a workspace switch by another
  name, and the dirty-document guard runs first.

## Migration Plan

1. Land the dependency, adapter, fake server and conformance tests, and ship the
   connect command enabled. The folder provider stays the default when a stored
   folder record exists.
2. Existing users: pre-marker handle records restore as `folder`; no data
   migration, no workspace content touched.
3. Rollback: remove the command and dependency; the added IndexedDB stores are
   additive and ignored by older builds. A stored remote connection is left
   inert, not deleted, so a re-deploy can still restore it.
4. Deploy through the normal `verify` + Pages workflow and verify on the deployed
   URL; this track does not gate the numbered layers.

## Open Questions

- Is public-vdir discovery by server URL alone worth an upstream endpoint, or
  does asking for the directory id stay acceptable? Deferred: it changes neither
  the specs nor the task breakdown.
