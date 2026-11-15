# Proposal

## Why

Stratofold 0.12.0 fixes zero-byte uploads and mints `sfconn_v1_` connection
strings, but Exo still pins 0.11.0 and its connect form only accepts a server
URL plus a token. Two user-visible gaps remain: New File in a remote workspace
still fails because it uploads an empty body, and connecting an app still
requires copying three separate facts. Adopting the new client closes both
without changing the workspace contract or the trust model.

## What Changes

- Upgrade the exact dependency from `@stratofold/client` 0.11.0 to 0.12.0 and
  update the lockfile; the package adds the connection-string parser and no
  breaking API change.
- Accept an `sfconn_v1_…` connection string in the connect flow. Parse it
  locally with the client's `parseConnectionString`, prefill the server, vdir
  and token from it, and validate with the existing `tokenInfo()` flow before
  any workspace mounts.
- Treat the connection string as a bearer-equivalent secret: discard the raw
  value after parsing, never send it, store it, log it, put it in a URL, or
  expose it to a plugin frame. A remembered connection still stores only the
  decomposed `{server, vdir, name, role, token}` record.
- Let the server-URL field act as the documented origin override when an
  embedded origin is stale; the vdir and token still come from the string.
- Report a malformed, truncated or unknown-version string as a local
  configuration error before any request, with no partial workspace.
- Support zero-byte remote files end to end: New File creates an empty file,
  reading it returns empty bytes, and saving empty content over a non-empty file
  replaces it and rotates the version. Remove the 0.11.0 empty-file workaround
  and residual-gap documentation.
- Extend the deterministic fake server and provider tests to cover zero-byte
  create, empty read and empty-over-non-empty replacement, and add connection
  string parsing, prefill and secret-handling tests.
- Update `docs/providers/stratofold.md`, the remote-provider section of
  `docs/contracts/workspace-api.md` and `ROADMAP.md` to describe 0.12.0, and
  measure the bundle against the existing budget.

**Explicit non-goals:** a new provider, a connection-string deep link or URL
scheme, server-side parsing, QR codes, token rotation, changing roles, expiry or
revocation, public-mode changes, and any use of `baseUrl` overrides beyond the
existing editable server field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `remote-workspace`: connection entry accepts an opaque connection string and
  rejects malformed values locally; the connection string is a shell-owned
  secret that is parsed and discarded; persisted records keep the decomposed
  fields only; remote empty files can be created, read and written.

## Impact

- `apps/shell/package.json` and `package-lock.json`: pin
  `@stratofold/client@0.12.0`.
- `apps/shell/src/workspace/providers/stratofold/connection.ts`: connection
  string parsing, a new local configuration error code, and mapping into the
  existing `ConnectRequest`/`StratofoldConnection`.
- `apps/shell/src/workspace/ConnectRemoteDialog.tsx`: connection string input,
  prefill, clearing semantics and error text; `runtime.ts` only if the connect
  request shape needs to carry the parsed result.
- `apps/shell/src/workspace/providers/stratofold/provider.ts`,
  `fake-server.ts` and the provider/runtime/App tests: zero-byte coverage and
  removal of the empty-file limitation.
- `docs/providers/stratofold.md`, `docs/contracts/workspace-api.md`,
  `ROADMAP.md`: version, connection-string behavior, empty-file status and the
  upstream-ask table.
- Bundle size: the client grows by the parser and connection-string decoder;
  `apps/shell/budget.json` changes only if the measured bundle exceeds the
  current limit.
