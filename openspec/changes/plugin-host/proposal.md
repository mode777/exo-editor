# Proposal

## Why

Layer 3 makes `exo.json` a validated, editable declaration, but it deliberately
loads nothing. Layer 4 is the trust boundary the whole product rests on: the
shell must turn a declaration into code only after the user approves the exact
origin and capability surface, then keep that code in a short-lived, origin-bound
frame. Today the consent, sandbox, registration and registry rules exist only in
contracts and specs. Implementing them now, before file editors and events depend
on them, is cheaper and safer than retrofitting a protocol around working code.

## What Changes

- Add a manifest pipeline: fetch each enabled entry with the contract's timeout,
  256 KiB cap, JSON content-type check, redirect handling and CORS/network
  reporting; validate the complete v1 manifest; resolve the controller and editor
  entries against the final URL; enforce origin equality, plugin-root containment
  and `engines.exo`; keep the manifest in memory only.
- Add consent as a hard gate: a dialog showing the exact origin, publisher,
  version, controller entry, plugin root, editor entries, permissions and globs,
  plus a same-origin warning; approve/deny; a machine-wide `localStorage` record
  keyed by origin, plugin id and capability fingerprint; re-prompt on widening;
  revoke from settings tears the plugin down.
- Add the registration host: hidden iframes mounted only after a valid manifest
  and consent; `allow-scripts allow-same-origin` for cross-origin plugins and
  `allow-scripts` only for same-origin first-party plugins; handshake, `shell/init`,
  `plugin/register`/`register-complete`, `shell/register-ack`; ready and
  registration timeouts; a three-violation budget; rollback of partial
  registrations; frame removal after acknowledgement.
- Add the plugin registry: identity is manifest origin plus plugin id; enabled
  entries initialize in `exo.json` declaration order; registered globs are
  matched with priority and deterministic declaration-order tie-breaking; the
  other matches remain available for "Open with..."; entries disappear when a
  plugin is disabled, removed or its consent is revoked.
- Bind the host to the workspace lifecycle: attach after the workspace is ready,
  load enabled plugins immediately when an entry is added, tear down on removal
  or switch, ignore late fetch and frame callbacks, and keep consent across
  workspaces while resetting registrations, status and log.
- Add the host surfaces: a Plugins-section status for every declared entry
  (loading, awaiting consent, denied, registering, active with its editor labels,
  or failed with a stable code), a consent dialog, and a workspace-scoped plugin
  log containing ids, phases and error codes but never file content.
- Add a stub plugin fixture served on `localhost:5174` and a same-origin copy for
  deployed verification. The shell CSP gains the `http://localhost:*` sources
  needed by the manifest contract's localhost rule; without it a deployed shell
  could validate such a manifest but never fetch or frame it.
- Update the contracts and specs for the decisions this layer has to settle:
  plugin identity and duplicate identities, duplicate glob declarations,
  declaration-order selection, registration acknowledgement shape and label
  defaults, shell-to-opaque-frame target origin, and the runtime status/log
  surface.

**Explicit non-goals:** handler frames for open documents, file reads or saves,
dirty state, external-change notifications, events, plugin settings
contributions, the SDK/template and the Monaco plugin. Layer 4 registers editor
contributions but opens no document with them.

## Capabilities

### New Capabilities

- `plugin-host`: workspace-scoped host lifecycle, deterministic initialization
  and identity, the registration registry and editor selection, and the
  per-workspace host status and log.

### Modified Capabilities

- `plugin-manifest`: defines plugin identity and duplicate-identity handling,
  rejects duplicate glob declarations, makes selection tie-breaking declaration
  order, and states how fetch rejections map to `cors` versus `network`.
- `plugin-protocol`: defines the registration contribution shape and label
  default, where priority comes from, the acknowledgement contents, duplicate
  registration handling, declaration-order sequence, and the target origin used
  for shell-to-plugin messages to an opaque same-origin frame.
- `editor-shell`: extends the Plugins settings surface with host status, consent
  actions and the workspace-scoped plugin log, and permits `http://localhost:*`
  in the deployed CSP so the declared localhost manifest rule is usable.

## Impact

- New source under `apps/shell/src/plugins/`: manifest fetch/validation and entry
  resolution, glob compilation and matching, consent fingerprint and store, the
  frame transport, registration state machine, plugin registry and host store.
- Changed: `WorkspaceRuntime` and its context, `App` (consent dialog), the
  Plugins settings section, `csp.ts` and its checks, the app styles and tests.
- Build: the shell version becomes `0.1.0` for `engines.exo`, `semver` is added
  for range checking, and the JS bundle budget is re-measured and updated
  deliberately after the change instead of allowing a silent regression.
- Fixtures: a stub plugin served on a second origin and copied into the deployed
  site for the same-origin sandbox check; a small static server script.
- Documentation: `docs/contracts/plugin-manifest.md`,
  `docs/contracts/plugin-protocol.md`, `docs/architecture.md`, matching OpenSpec
  deltas, and the roadmap/agent status on completion.
- No backend, proxy, secret or runtime dependency beyond `semver` is added. The
  shell still has no handler session and no path to file content in this layer.
