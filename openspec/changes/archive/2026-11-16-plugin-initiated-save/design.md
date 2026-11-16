# Design

## Context

See `proposal.md` for motivation and the four delta specs for normative
behavior. This change sits on the layer 9 implementation:

- `HandlerSession` already owns one live `shell/request-save` plus one queued
  request, accepts `plugin/save-content` only with a matching `replyTo`, and
  sends `shell/save-result` through `completeSave`.
- `DocumentStore.savePlugin` owns the write, `ifVersion`, dirty-sequence capture,
  conflict mapping and `editors.completeSave`. The shell Save action and the
  command palette both go through it.
- `EditorClient` already exposes `onSaveRequest`, `onSaveResult`, dirty and
  external-change handling. It has no request/trigger API.
- `apps/code-plugin` already sends `plugin/dirty`, answers saves with the current
  model text and stores a `__exoCode` diagnostic hook.
- Handler frames are sandboxed and keyboard events inside them do not reach the
  shell, so the trigger must be a protocol message.

## Goals / Non-Goals

**Goals:**

- Let an interactive editor ask the shell to save without giving the plugin the
  writer role, the version choice or a second content path.
- Keep the existing save serialization, timeout, conflict and dirty rules exactly
  as they are.
- Make the SDK addition small and additive, and let a plugin degrade to the Shell
  Save action when a shell predates the message.
- Wire Ctrl/Cmd+S in the reference editor and remove the documented limitation.

**Non-Goals:**

- Autosave, save-all, multi-file writes, retries or a save queue owned by the
  plugin.
- Accepting unsolicited `plugin/save-content` or any plugin-chosen `ifVersion`.
- A protocol major bump, manifest field, consent change or new shell UI.
- Predicting a new shell capability from `shell.version`.

## Decisions

### D1 - The message is an id-less save intent, not a content submission

`plugin/request-save` has no `id` and no non-empty payload. It means "run the
normal Save action for my document". The shell answers with the existing
`shell/request-save`; the plugin answers with `plugin/save-content`; the shell
writes and sends `shell/save-result` for that request.

Alternatives: allow `plugin/save-content` without a live request (breaks the
"content only on request" invariant and duplicates correlation); make it a
correlated request with a new acknowledgement (more state and a new result type
for no write benefit); add a `write-now` message carrying content and version
(gives the plugin control the shell must not relinquish).

An id or non-empty payload is a protocol violation because they would make the
message look like a request or a content path. The empty envelope and an optional
empty object payload are accepted so the SDK's generic send shape is harmless.

### D2 - Reuse the existing save path through one callback

`HandlerSession` gains an optional `onSaveRequested` callback. On a valid
notification it calls the callback and does nothing else. `HandlerPool` passes a
path-scoped callback; `WorkspaceRuntime` wires it to `DocumentStore.save(path)`.

No content or version crosses the new path. `DocumentStore.savePlugin` remains
the only writer and the existing `pendingSaves` map coalesces a trigger that
arrives while a save is already in flight. The normal `shell/request-save` and
`shell/save-result` round trip is unchanged, so dirty-sequence and conflict logic
stay in one place.

Alternatives: give `HandlerSession` a `DocumentStore` reference (couples the
protocol state machine to the document store); have the trigger call
`HandlerSession.requestSave()` (that is the shell-to-plugin direction and would
send a second save request); write directly from the handler (duplicates
versioning and conflict handling).

### D3 - The runtime keeps the Save action's eligibility checks

The trigger is accepted only from an active handler frame (phase dispatch already
enforces this). The runtime callback checks that the document still has the
plugin surface, is active and is dirty before calling `DocumentStore.save`. A
read-only, clean, disposed or non-plugin document is a no-op. `savePlugin` keeps
its own `canWrite`, deleted-file and permission checks as the final authority.

This prevents a trigger from becoming a way to write clean content, bypass the
Save permission, or save a document that was replaced by a workspace switch. The
shell does not send an error for a no-op trigger; the plugin is expected to check
its own dirty and capability state, and there is no result to correlate.

Alternatives: send `shell/error` for every ignored trigger (id-less errors have no
correlation and would pollute the log on a harmless clean-document Ctrl+S);
remove the runtime dirty check and let the plugin decide (a malicious plugin could
rewrite the same content repeatedly).

### D4 - `requestSave()` is fire-and-forget; the result listener is the outcome

`EditorClient.requestSave(): void` sends one id-less notification. It does not
create a pending map entry, does not return a promise and does not wait for a
result. The plugin's existing `onSaveResult` listener receives the normal result
when the shell's save completes; the reference editor already uses it to clear
dirty and show failures.

This is deliberate: a promise would need to know whether the shell ignored the
trigger (clean/read-only) or started a save, and the protocol has no reliable
"started" signal. A timeout on a save intent would be a second timeout policy.
The plugin checks `dirty` and `capabilities.write` before calling, and the Shell
Save action remains the fallback if a pre-change shell ignores the message.

The SDK package moves from `1.0.0` to `1.1.0`: an additive client method is a
minor release per the compatibility policy, while the protocol major stays `1`
and the manifest schema is untouched.

### D5 - Monaco binds the accelerator, not the save flow

The reference editor adds `monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS` with
`editor.addCommand`, calls `preventDefault` through Monaco's command handling and
calls `client.requestSave()` only when the local `dirty` flag is true and
`client.capabilities.write` is true. It does not construct content, does not
touch `ifVersion`, and does not clear dirty until `onSaveResult` reports success.

The command's UI state follows the existing status strip. If a pre-change shell
ignores the notification, Ctrl+S does nothing and the shell's Save button still
works; the plugin does not guess from `shell.version`.

### D6 - Tests bind the new message to the existing invariants

- SDK: one id-less `plugin/request-save` with no payload, no pending request, no
  `plugin/save-content` and no dirty change.
- Handler: accepted notification calls the callback once; an `id`, a non-empty
  payload, a wrong phase or a disposed frame does not; a trigger during a live
  save does not create a second request.
- Document/runtime: a dirty active frame triggers exactly one `DocumentStore.save`;
  a clean, read-only, inactive or switched document triggers none; the existing
  save-result/conflict/timeout tests still pass.
- Reference plugin: source test asserts the Ctrl+S command calls `requestSave` and
  does not construct `plugin/save-content`; the deployed verification presses
  Ctrl+S in Monaco and observes one shell save and one result.

## Risks / Trade-offs

- **A plugin can trigger repeated writes** → the runtime dirty check and the
  existing in-flight coalescing make repeated presses cheap; after a successful
  save the plugin is clean until it reports dirty again. The plugin already has
  `workspace:write` consent, and no trigger bypasses `savePlugin`'s checks.
- **A pre-change shell ignores the message** → the notification is id-less and
  additive; Ctrl+S is a no-op and the shell Save action still works. The deployed
  shell and reference plugin ship together in this repository.
- **An id-carrying notification is rejected** → the protocol says id-less, the SDK
  never sends an id and the handler tests pin the violation.
- **Ctrl+S is captured while focus is outside Monaco** → the command is attached
  to the Monaco editor instance, so the shell's own shortcuts are untouched.
- **A save trigger races a workspace switch** → the runtime path lookup and
  `DocumentStore` generation checks drop the stale callback; no write reaches the
  new workspace.
- **A clean document receives a trigger** → no write and no result; the plugin
  only calls when dirty, and the no-op is logged at most as a handler event.

## Migration Plan

- Deploy the shell and reference plugin together through the normal `main` push.
- No stored data, workspace file, manifest, consent record or protocol version is
  migrated. A shell that predates the message ignores it; the plugin's Save button
  path is unchanged.
- Rollback removes the handler case, SDK method and Monaco binding; existing
  saves, content flow and versioning are unaffected.

## Open Questions

None. The id-less shape, reuse of the existing save path, SDK minor bump and
Ctrl+S scope are decided above and reflected in the specs and tasks.
