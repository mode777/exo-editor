# Design

## Context

See [`proposal.md`](./proposal.md) for motivation. Commands already have one
controller and one target resolution path: `PluginCommandController.invoke`
resolves an active `CommandTargetSession`, sends `shell/command`, owns the
single-flight/cooldown/concurrency gates and settles on result, timeout,
disposal or workspace reset. `FrameSession` owns the frame's focus check,
picker and new-file handlers, and clears pending dialogs on every teardown path.
The runtime already wraps those handlers with visibility and focus checks in
`HandlerPool` and `ViewPool`.

The missing piece is that focus is a DOM property of the whole shell, while a
command invocation is a temporary user action directed at one plugin frame. The
shell must not move focus to express that intent.

## Goals / Non-Goals

**Goals:**

- Let the exact command target frame open the picker or Save As dialog while its
  invocation is live, without DOM focus and without a new permission.
- End the grant on every existing command settlement, timeout and teardown path.
- Keep the grant frame-scoped and invocation-scoped, including concurrent
  commands from the same plugin on different frames.
- Keep the direct panel-button behavior, all existing limits and the older-shell
  fallback unchanged.

**Non-Goals:**

- Auto-focusing panels, content views or editors.
- Allowing hidden or disposed frames to create files.
- A background-plugin write capability, command retargeting, a new protocol
  message, manifest field, permission, capability bit or SDK API.
- Changing new-file template behavior.

## Decisions

### D1 - The grant lives on `FrameSession`, keyed by invocation id

`FrameSession` gains a private `Set<string>` of live invocation ids and three
small methods: `beginUserInvocation(id)`, `endUserInvocation(id)` and
`hasLiveCommandInvocation()`. A set rather than a boolean lets multiple commands
from one plugin target the same frame without one result clearing another
invocation's grant, while the frame itself still belongs to exactly one plugin
identity. Only the target session receives `beginUserInvocation`; no global
registry or plugin-wide flag exists, so another frame cannot be authorized.

The focus gate becomes `visible() && (hasFocus() || hasLiveCommandInvocation())`
for both `plugin/request-new-file` and `plugin/request-files`. The existing
permission, capability, writable-session and size checks run before it. The
picker's one-pending rule, the new-file rate limits and the shell-owned dialogs
are untouched. The existing pool wrappers use the same predicate rather than a
separate flag.

### D2 - The command controller owns the grant lifetime

`CommandTargetSession` gains optional `beginUserInvocation`/`endUserInvocation`
methods. `PluginCommandController.invoke` calls `beginUserInvocation` before
`sendCommand` and `clearPending` calls `endUserInvocation`, so every path that
already settles an invocation revokes the grant: success, failure, invalid
result, timeout, frame close, plugin stop and `reset` on workspace switch. The
methods are optional so older fake sessions and structural hosts keep working.

`FrameSession.handleCommandResult` also ends the grant for the envelope's
`replyTo` before notifying listeners. This is the ordering boundary that makes a
handler which answers first and then requests a dialog a late request. Ending an
already-ended id is idempotent.

### D3 - Teardown clears the set explicitly

`dispose`, `close`, `fail` and `finishDispose` clear the set before notifying
close listeners, so no dialog request can race a disposal. Disposal already
aborts a pending picker/new-file request and drops a late outcome; the grant
removal means a fresh request after teardown is denied even if the frame object
is still reachable in a test.

### D4 - No focus, protocol or permission change

The controller never calls an iframe focus method and the frame session never
touches `document.activeElement`. The grant is shell-internal state and is not
advertised in `shell/init`, the manifest schema, consent or the SDK. An older
shell still returns `permission-denied`, so the feature is safe to use behind
the existing `capabilities.createFile` and `capabilities.filePicker` checks and
the plugin can keep its `newFiles` fallback.

### D5 - Tests exercise the real frame and controller together

The unit tests cover the grant set and settlement on the controller. A dedicated
shell-level suite wires a real `ViewSession` to `PluginCommandController` and a
scripted handler sends the request when `shell/command` is delivered. It covers
panel and content-view targets, result and timeout expiry, another frame,
read-only and missing-permission cases, the picker, disposal with a pending
dialog, direct focused behavior and the unfocused background denial.

## Risks / Trade-offs

- **A command times out while its dialog is open** -> the dialog was already
  authorized and continues under its own settlement rules; the grant only
  affects opening a new request, and a late request is denied. Disposal still
  aborts the pending dialog.
- **Concurrent commands target one frame** -> the set keeps the grant while any
  invocation remains live, which matches "the frame is the user's current
  command target"; the command system's own limits still bound concurrency.
- **A handler answers and then asks for a dialog** -> the result clears the
  grant before listeners run, so the later request is denied by design.
- **An older shell** -> it denies the request; the plugin's existing
  `capabilities` checks and `newFiles` fallback remain valid.

## Migration Plan

1. Add the per-frame grant and use it in the picker/new-file gates.
2. Mark the target before delivery and clear it on every settlement/teardown.
3. Add the unit and shell-level tests, update the contracts/specs/guide and bump
   the shell to `0.8.0`; protocol, manifest schema and SDK stay unchanged.
4. Existing plugins need no change. Tenon may remove its `newFiles` workaround.
   Rollback is a redeploy of the previous commit; no state or schema migration
   is involved.

## Deployed verification

Verified on 2026-11-23 against deployed commit `5bc072a` at
`https://mode777.github.io/exo-editor/`. The CI `verify` job passed and the Pages
deploy job completed. The served document references the same build produced
locally, `assets/index-BLE9GFXZ.js`; the deployed asset is 626,804 bytes, reports
shell `0.8.0` and no longer carries `0.7.0`.

The automated shell gate covers the invocation grant end to end with a real
`ViewSession` and `PluginCommandController`: unfocused panel and content-view
commands create a file, the picker receives the same grant, post-result and
post-timeout requests are denied, another frame stays denied, read-only and
missing-write cases stay denied, disposal drops a pending dialog, direct focused
use still works and focus is never moved. The deployed smoke check confirms that
this tested build is the published artifact. Tenon itself is an external plugin
and was not replayed from this repository.
