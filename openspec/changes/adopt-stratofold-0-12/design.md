# Design

## Context

See `proposal.md` - Why. The existing provider is implemented in
`apps/shell/src/workspace/providers/stratofold/` and is pinned to
`@stratofold/client` 0.11.0. The connect dialog collects a server URL, an
optional access token and, for public mode, a directory id; `connectStratofold`
normalizes the server, probes `tokenInfo()` with a sentinel vdir, and reuses
`StratofoldWorkspaceProvider`. Remembered records already store
`{server, vdir, name, role, token}` in IndexedDB.

`@stratofold/client` 0.12.0 is additive: it exports `parseConnectionString` and
`StratofoldClient.fromConnectionString`, and changes no existing signature. The
zero-byte fix is server-side; the client and Exo adapter already send an empty
`ArrayBuffer`, so the visible Exo change is that New File stops receiving a
`503` from a 0.12.0 server.

## Goals / Non-Goals

**Goals:**

- Make "paste one connection string" the fastest valid connect path without
  changing the existing token, public-directory or reconnect flows.
- Keep the connection string and its token out of URLs, storage, logs, error
  text, bundles and plugin frames.
- Prove zero-byte create, read, replace and conflict behavior through the
  published client and the deterministic fake server.
- Preserve the existing remembered-connection schema and restore path.

**Non-Goals:**

- No new provider, no server-version probe, no fallback to a different client
  version, and no connection-string handling in the runtime if the dialog can
  resolve it first.
- No link, QR code, custom URL scheme, clipboard integration or connection
  string display in the shell.
- No changes to token roles, expiry, revocation, public mode or the workspace
  session contract.

## Decisions

### Decision 1: Treat the connection string as a connect-form input, not a new runtime request

Add a pure resolver in `connection.ts` that wraps the client's
`parseConnectionString` and returns the existing `ConnectRequest` shape. The
dialog uses it to prefill server, vdir and token. Submitting still calls
`runtime.connectRemote({ server, token, vdir }, ...)`, so the raw string never
enters the runtime, the provider, the source, the store or a snapshot.

Alternatives rejected:

- **Add `connectionString` to `ConnectRequest` and parse in the source.** It
  carries the raw secret through more layers for no behavioral gain, and the
  dialog would still need the parsed fields to show the resolved server and
  directory before submit.
- **Build the client with `fromConnectionString` and bypass `connectStratofold`.**
  That would duplicate token validation, public-mode handling, role checks and
  the `StratofoldConnection` construction, and would split the connect flow into
  two paths.
- **Use `fromConnectionString` for the real client only.** The separate
  constructor with parsed fields is equivalent; using both would add a second
  client-construction path to test.

The resolver maps `ConfigurationError` to a new
`StratofoldConnectError('invalid-connection-string', ...)` with a fixed message
that names the expected prefix and fields but never echoes the value. Validation
is local, so a malformed string produces no network request. The existing
`tokenInfo()` probe and vdir mismatch check still run after a successful parse.

### Decision 2: Parse on paste and again on submit; clear the raw string once it resolves

The dialog adds a password-style "Connection string" field with autocomplete
off. On change it attempts a local parse; on success it fills server, vdir and
token and clears the field, so the raw value exists only for the duration of one
input event. A partial string is not treated as an error while typing; submit
parses whatever remains and reports the fixed configuration error if it is still
invalid. A failed connect clears the token, as today, and keeps the resolved
server and directory for a retry.

The parsed server fills the existing editable server field. Submitting uses that
field, so correcting a stale embedded origin requires no special override
control and works exactly as `baseUrl` overrides do upstream; vdir and token
still come from the string.

Because the parsed vdir is present even in token mode, the dialog now passes a
non-empty `vdir` whenever it has one. `connectWithToken` already rejects a
mismatch, so this turns a wrong directory from a silent token-derived value into
an explicit `mismatch` error. The public-directory path is unchanged.

### Decision 3: Discard, do not persist, the raw connection string

No store migration is needed: the remembered record keeps the existing
decomposed fields and never gains a connection-string field. A connection-string
connection is indistinguishable from a URL-plus-token connection after parsing,
so restore, reconnect, forget and workspace identity behave as before. Tests
serialize the remembered record and assert that neither `sfconn_v1_` nor the raw
input appears.

The dialog is the only component that ever holds the raw value, and it is
cleared on a successful parse, on close and on submit. It is never logged. The
error text and workspace log carry codes, never the value or a token hint.

### Decision 4: Zero-byte support is a dependency bump plus regression coverage

The adapter already passes `data.slice().buffer` to `upload`, including for a
zero-length `Uint8Array`, and already `stat`s after the upload. The 0.11.0
failure was in the server's transfer pipeline, fixed in 0.12.0, so no
provider-specific workaround should be added or kept. Add provider tests that
create an empty file with `create: true`, read it back as zero bytes, replace a
non-empty file with empty content and assert the version rotates, and attempt an
empty write with a stale `ifVersion` and assert `conflict` with the original
bytes intact. The fake server already models an atomic upload and version
rotation; no test-only failure mode is introduced.

Document that the guarantee needs a 0.12.0 server: a 0.11 server still returns
`503` for an empty upload, which the existing error mapping reports as `io`.

### Decision 5: Update the normative provider description, not the workspace contract

`workspace-api.md` already allows a zero-length write and already treats the
remote provider as one implementation of the session contract. Its remote section
gains the connection-string input and the version-independent rule that empty
files write normally; no interface, error code or session method changes. The
`remote-workspace` delta is the behavior contract; `docs/providers/stratofold.md`
remains the place for the version matrix, residual gaps and upstream asks.

## Risks / Trade-offs

- **The connection string is as sensitive as the token and briefly lives in a
  form field** -> Use a password input, autocomplete off, clear it on successful
  parse and on close, never log or store it, and assert in tests that the raw
  value does not appear in the record.
- **A user edits the server after pasting a connection string** -> The token and
  directory still come from the string, and `tokenInfo()` validates the pair
  against that origin; a wrong origin surfaces `unauthorized` or `network`
  rather than mounting. This is the same escape hatch upstream documents.
- **A 0.11.0 server remains reachable** -> Empty uploads still fail there. State
  the server-version requirement in the provider doc and keep the failure mapped
  as `io`; do not probe or version-detect.
- **Parsing on every change could show errors mid-typing** -> Only a successful
  parse changes state and clears the field; a failure is displayed on submit, so
  partial input never flashes an error.
- **The connection-string decoder grows the bundle** -> Measure `npm run budget`
  after the bump and raise `apps/shell/budget.json` only with the recorded
  measured delta, not pre-emptively.
- **Existing dialog tests may assume the vdir is omitted in token mode** ->
  Update them to the new explicit-mismatch behavior and keep the public-mode
  test asserting that no token is created or stored.

## Migration Plan

Deploy as a normal shell change. Existing remembered records restore unchanged
because the schema is unchanged. A rollback restores the 0.11.0 pin and the old
dialog; connections created in the meantime still restore because they use the
same fields. The zero-byte path degrades to the old `503` on a reverted client
and server, with no stored-state migration.
