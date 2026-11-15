# Proposal

## Why

Exo can only open a local folder, so the workspace layer is Chromium-only (D10)
and the provider abstraction is unproven beyond two in-repo implementations.
Stratofold now publishes `@stratofold/client` 0.11.0 on npm (verified 2026-11-15:
`latest`, zero runtime dependencies, ISC, ESM with types), which removes the only
blocker on roadmap track P1. A remote workspace gives the shell a real second
backend without a backend of its own: the browser talks to the vdir directly
with a user-supplied token.

## What Changes

- Add `@stratofold/client` `0.11.0` (exact pin) to `apps/shell` and implement
  `StratofoldWorkspaceProvider` against the existing `WorkspaceProvider` /
  `WorkspaceHandle` interface. No new provider methods and no protocol changes.
- Add a provider selection to the runtime: the shell can open a local folder or
  connect a Stratofold remote workspace, and switching between them is the same
  workspace switch (tabs, plugin state, caches, open documents all reset).
- Add a connect flow: server URL plus token (editor or viewer), or a public vdir
  with no token. The connection is validated before any workspace is mounted,
  and the token's scope decides `writable`.
- Keep the credential shell-owned (D17): header-only transport, never in a URL,
  the bundle, logs, or a plugin frame; persistence only through an explicit
  "remember this connection" opt-in, otherwise session-only.
- Surface a rejected or revoked credential as an explicit reconnect state; never
  retry silently and never report it as a generic IO failure.
- Persist and restore a remembered connection; a viewer or public workspace is
  read-only end to end (no editing, no save, no mutations).
- Record the publication and withdraw blocker B1 from
  `docs/providers/stratofold.md` and the P1 status in `ROADMAP.md`.

Out of scope: multi-root workspaces, sync/offline, background upload, file
watching, OAuth or a token broker, other remote providers, and promoting the
track into the numbered v1 critical path.

## Capabilities

### New Capabilities

- `remote-workspace`: connecting, validating, remembering, restoring and
  reconnecting a remote workspace; shell-owned credential handling; read-only
  roles; and the reconnect state when the credential stops working.

### Modified Capabilities

- `workspace-access`: which provider backs a workspace becomes a runtime choice
  rather than a fixed folder provider, a switch across provider kinds resets the
  same workspace-scoped state, and the unsupported-browser state must offer the
  remote path instead of a dead end (while still never showing a mock explorer).

## Impact

- Code: `apps/shell/src/workspace/runtime.ts` (provider selection, restore by
  provider kind), new `apps/shell/src/workspace/providers/stratofold/`
  (adapter, error mapping, connection store), connect dialog and commands,
  explorer/status banner for the reconnect state, `App.tsx` composition.
- Contracts and docs: `docs/contracts/workspace-api.md` and
  `openspec/specs/workspace-access/spec.md` for provider selection and the
  unsupported state; `docs/providers/stratofold.md` for the published client and
  the connect-form decision; `ROADMAP.md` P1 row and exit criteria.
- Dependencies: `@stratofold/client` `0.11.0` (exact), ~14 KB unminified
  source / zero transitive dependencies.
- Verification: provider conformance against a fake Stratofold server (the
  client's `fetch` seam), credential/URL/plugin-boundary tests, and deployed
  verification against `https://mode777.github.io/exo-editor/`.
- Bundle budget and the deployed CSP (`connect-src 'self' https:
  http://localhost:*`) must be re-checked; no new directive is expected.
