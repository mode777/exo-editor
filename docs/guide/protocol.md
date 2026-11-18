# Protocol

The shell and a plugin talk over one versioned `postMessage` channel. The
normative messages, payloads, limits, error codes and ordering rules live in
[`docs/contracts/plugin-protocol.md`](../contracts/plugin-protocol.md). The
plugin SDK implements this page; read it when debugging or writing your own
client.

## Two frames, one plugin

1. **Controller frame.** The shell mounts `runtime.entry` from the manifest as a
   hidden iframe. It appends `exo-host`, `exo-mode=register` and `exo-session` to
   the fragment.
2. The controller sends `plugin/ready` with the protocol version and echoes the
   session id. The shell answers with `shell/init` (workspace metadata, theme,
   locale, permissions, limits and settings; no file content).
3. The controller declares editors with `plugin/register`, then
   `plugin/register-complete`. The shell answers with `shell/register-ack` and
   removes the controller frame after the acknowledgement.
4. **Handler frame.** When a matching file opens, the shell mounts
   `contributes.fileEditors[].entry` with `exo-mode=editor` and a new session.
   It sends metadata only in `shell/init`. The handler asks for bytes with
   `plugin/request-file`; content crosses only in the reply.

Each frame has its own session id. A message from a different window, a different
origin, or a missing or wrong session echo is dropped. A same-origin plugin runs
in an opaque origin, so its reported origin is `"null"`; identity is the frame
instance plus the session echo, not the origin string.

## The handler loop

- Read: `plugin/request-file` with a path and `'utf8'` or `'binary'`. The shell
  resolves relative paths against the open file, enforces the workspace root,
  reserved paths and the advertised size caps, and answers with
  `shell/file-content` or `shell/error`.
- Select files: `plugin/request-files` asks the shell to open its workspace file
  picker. Check `capabilities.filePicker` first; `capabilities.requestFiles`
  alone is the older read permission bit and does not prove support. The reply
  is `shell/files-selected` with selected paths or `[]` on cancel; it contains no
  content. Read each path with `plugin/request-file`. The picker is available
  only to an active, visible, focused handler; an older shell answers
  `unsupported-message`, so keep a manual path-entry fallback.
- List: `plugin/request-list` asks for one directory level and requires the
  manifest's `workspace:list` permission. Check
  `capabilities.directoryListing` first; absence means an older shell. The reply
  is `shell/list-result` with at most 1,000 entries sorted directories first and
  an opaque `nextCursor` when more remain. Entries carry `path`, `kind` and, for
  files, `size`; no content, `mtime`, version or handle. Later pages come from a
  stable snapshot, so re-list without a cursor to observe new files. A file path
  returns `not-a-directory`, a missing directory `not-found`, and a malformed or
  expired cursor also `not-found`.
- Dirty: the plugin reports `plugin/dirty`. The shell never infers it from
  content.
- Save: the shell sends `shell/request-save`; the handler replies with
  `plugin/save-content` carrying the current text or bytes. The shell writes with
  `ifVersion` and answers `shell/save-result`. A conflict leaves the tab dirty
  and the newer disk content in place.
- Save intent: `plugin/request-save` is an id-less notification that the user
  wants to save. It carries no content and no version; the normal shell-initiated
  round trip still does the write.
- External change: `shell/file-changed` tells the handler that the file changed,
  was deleted or was renamed. Do not silently replace a dirty buffer; the shell
  also owns its own notice.
- Dispose: the shell sends `shell/dispose`, waits for `plugin/dispose-ack` up to
  the contract limit and removes the frame. A closed frame accepts no later
  messages.

## Events

If the manifest has `events:subscribe`, the handler can subscribe to the v1
topics. The catalog, payloads, sequence numbers, coalescing and queue limits are
in [`docs/contracts/events.md`](../contracts/events.md). Initial theme and
workspace state are already in `shell/init`; events carry changes, not replay.

## Errors

The shell answers a correlated request with `shell/error` and a stable code. A
plugin must not invent new codes or send content outside the save flow. The
complete vocabulary and the conditions that produce each code are in the
protocol contract's error section.

## Versioning

The envelope carries `exo: 1`; the protocol major is negotiated in the handshake.
A mismatch produces `unsupported-version` before any registration or file
message. Additive optional fields stay within protocol major 1; removing or
reinterpreting a field requires a new major. The release plan is in
[`docs/releases.md`](../releases.md).

Next: [use the SDK](./sdk.md) so you do not hand-write this flow.
