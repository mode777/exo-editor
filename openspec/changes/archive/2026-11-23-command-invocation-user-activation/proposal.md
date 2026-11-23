# Proposal

## Why

A plugin command that targets a panel or content view runs in that frame, but the
frame usually does not own DOM focus: the user invoked the command from the
palette or explorer. The shell currently requires DOM focus for
`plugin/request-new-file` and `plugin/request-files`, so a panel command cannot
create dynamic content or open the workspace picker. The Tenon plugin fails with
`permission-denied` when its panel-target New Schema command calls
`requestNewFile()`, and its only workaround is a fixed manifest template that
cannot generate content.

## What Changes

- While a plugin command invocation is live for its exact target frame, treat
  that frame as user-activated for `plugin/request-new-file` and
  `plugin/request-files` even when it does not own DOM focus.
- Start the grant before `shell/command` delivery and end it when the matching
  `plugin/command-result` is handled, the invocation times out, the frame is
  disposed, the plugin stops or the workspace switches.
- Scope the grant to the exact plugin identity, frame/session and live
  invocation. A different frame is never authorized, and a request after the
  result or timeout is denied.
- Do not focus the frame or change the shell's active element.
- Keep every existing permission, capability, visibility, size, rate, create-only
  and shell-owned dialog rule unchanged. Hidden frames still cannot create files.
- Update the protocol, file-creation and command contracts, the author guide,
  the OpenSpec specs, the shell version and the changelog. No permission,
  protocol message, manifest field, capability bit, consent fingerprint input or
  SDK API is added.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-commands`: adds an invocation-scoped user-activation grant for the
  target frame and its focus-gated file dialogs.
- `plugin-protocol`: makes the picker and new-file requests accept a live
  command target without DOM focus and keeps the existing limits.
- `plugin-file-creation`: records the same grant for runtime new-file requests
  and its revocation on result, timeout, disposal and plugin stop.

## Impact

- `apps/shell/src/plugins/commands.ts`, `frame-session.ts`, `handlers.ts` and
  `view-pool.ts`.
- `apps/shell/src/plugins/commands.test.ts` plus a new shell-level
  command-invocation grant test covering panel and content-view targets, result
  and timeout expiry, another frame, read-only workspaces, the picker, focus
  behavior and disposal.
- `docs/contracts/plugin-protocol.md`, `docs/guide/protocol.md`,
  `docs/guide/manifest.md`, `docs/guide/sdk.md`, `docs/performance.md`,
  `docs/releases.md`, `CHANGELOG.md`, `ROADMAP.md`, `AGENTS.md`, `README.md` and
  the matching `openspec/specs/` requirements.
- Shell `0.8.0`; protocol `1`, manifest schema `1` and SDK `1.8.0` unchanged.
- No backend, workspace contract, schema, consent or bundle-budget change. An
  older shell still denies the request, so a plugin can keep its `newFiles`
  fallback.
