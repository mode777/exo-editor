# Plugin Events Contract (v1)

Status: ratified by the OpenSpec change `define-core-contracts`. Normative
requirements are mirrored in `openspec/specs/plugin-events/spec.md`.

## 1. Purpose

Shell-to-plugin notifications - theme changes, file changes, workspace closure,
plugin configuration - travel over a topic subscription API carried by the same
envelope as the plugin protocol. Workspace-wide notifications use topics only;
the targeted `shell/file-changed` message for an open document (section 5.4 of
[`plugin-protocol.md`](./plugin-protocol.md#54-external-changes)) stays a
protocol message and is not a second subscription channel. Both forms derive
from the same observation.

Events are **push, not RPC**: a topic has no request/response pair, the shell
does not wait for a plugin to handle one, and a slow plugin cannot block another.

## 2. Subscription messages

```text
plugin/subscribe    { topic: string }
plugin/unsubscribe  { topic: string }
shell/subscribed    { topic: string, seq: number } | { topic, code: 'unsupported-topic' }
shell/event         { topic: string, seq: number, payload: unknown }
```

- `plugin/subscribe` is idempotent. Re-subscribing returns the current `seq`.
- `PluginPermission` `events:subscribe` is required; without it the shell replies
  `permission-denied`.
- `config/changed` is targeted: only the subscribed handler frames of the plugin
  named in the payload receive it. A frame of another plugin receives neither the
  event nor the values, even if it subscribes to the topic.
- Unknown topics are rejected with `unsupported-topic`; the shell does not
  wildcard-match topics.
- Subscriptions belong to a frame. They are not persisted and do not survive
  `shell/dispose`.
- Only handler frames may subscribe. Registration frames are too short-lived;
  a plugin that needs events without an open document needs a background frame,
  which is not part of v1. This is sufficient for the reference editor: theme and
  file changes matter while a document is open, and a closed document has nothing
  to render.

## 3. Event shape

```ts
interface ShellEvent<T> {
  topic: string
  /** Monotonic per workspace session, per topic. Resets on workspace switch. */
  seq: number
  payload: T
}
```

- `seq` starts at 1 for the first event a frame receives after subscribing; the
  `shell/subscribed` reply carries the current value so a plugin can detect a
  gap. With one subscriber per topic this is enough; the shell makes no
  cross-topic ordering promise.
- Delivery is at-most-once. A dropped event is not replayed.
- The shell delivers to every live frame of every plugin subscribed to the topic,
  independently. One plugin's failure to process does not affect another.
- Event payloads must be structured-cloneable and contain no functions, handles
  or DOM nodes.

## 4. Topic catalog (v1)

| Topic | Payload | When |
| --- | --- | --- |
| `theme/changed` | `{ theme: 'dark' \| 'light' \| 'high-contrast' }` | The user changes the shell theme |
| `workspace/file-changed` | `{ path, kind: 'created' \| 'changed' \| 'deleted' \| 'renamed', version? }` | A file in the workspace changes, including saves from other tabs |
| `workspace/closed` | `{ reason: 'switch' \| 'close' }` | The workspace is being released; the last event a frame receives |
| `config/changed` | `{ pluginId, values: Record<string, unknown> }` | A plugin's contributed settings change; only that plugin's subscribed handler frames receive it |

Topic names are `<namespace>/<event>`, lowercase, `[a-z0-9-]` segments, maximum
64 characters. New topics are added by changing this contract and the OpenSpec
spec; a plugin must ignore topics it does not know.

`config/changed` carries the full new value map for the named plugin, not a
delta. It requires `events:subscribe`, and the shell delivers it only to that
plugin's live handler frames. A plugin without the permission, or with no open
handler, gets the current values from `shell/init` the next time a frame mounts.
Settings are shell-owned; no other plugin can read them through this topic.

### `workspace/closed` ordering

`workspace/closed` is best-effort and races `shell/dispose`. The shell sends it,
then disposes the session; a plugin must not rely on receiving it and must treat
`shell/dispose` as authoritative.

### File change coalescing

- Changes to the same path within 50 ms are coalesced into one event. `deleted`
  wins over `created`, which wins over `changed`.
- Renames are reported as `renamed` with the new path; the old path is not
  emitted separately.
- The shell emits changes it observes: provider watch events, its own successful
  saves, and polling diffs. Events caused by a save are emitted after the save
  result, so a plugin sees `save-result` before `file-changed` for its own file.
- A dirty handler is never auto-reloaded. The plugin decides what to do with the
  notification.
- The targeted `shell/file-changed` message is sent to the bound document's
  handler immediately for every observed change, without coalescing. A
  subscribed frame also receives the coalesced `workspace/file-changed` event;
  both carry the same `path`, `kind` and, where present, `version`.
- A shell write records its path and version for one second. A watcher or poll
  report with the same path and version in that window is an echo and is not
  published again; a different version is a real external change.

### Observable scope

Both providers report `watchable: false` in v1, so the session observes changes
to open documents through its focus/visibility poll; a future watchable provider
feeds the same callback. A change to a file that is neither open nor written by
the shell is not observed and produces no event. Whole-tree watching is a
provider capability, not an event-bus feature.

## 5. Initial state

The shell does not replay a history. `shell/init` carries the current `theme`,
`workspace.name` and the plugin's current settings values, so a frame can render
without subscribing. `config/changed` is then incremental.

## 6. Limits and failure

| Limit | Value |
| --- | --- |
| Topics per frame | 32 |
| Queued events per topic per frame | 1000 |
| Event payload | 1 MiB |
| Publish rate per topic | 100 events/s (coalesced topics may burst) |

- On queue overflow the shell drops the oldest events and sends one
  `shell/error` with `rate-limited` and the topic name. It does not tear down the
  frame for overflow. The queue is drained in a microtask and is a burst bound,
  not backpressure: `postMessage` has no acknowledgement.
- Non-coalesced topics publish at most 100 events per rolling second; events
  beyond that are dropped and not replayed. Coalesced file changes are exempt
  from that gate because they are already merged per path.
- A frame that repeatedly sends invalid subscription messages is treated as a
  protocol violation under
  [`plugin-protocol.md`](./plugin-protocol.md#6-errors).
- Event publication must never throw into the shell's render path. A failing
  subscriber is logged and removed from the delivery set after three failures.

## 7. Versioning

- Topics are versioned by name only (`theme/changed`, not `theme/changed.v2`).
  A breaking payload change ships under the same topic only with a protocol
  major bump, because plugins and shell are deployed independently.
- Additive payload fields are allowed; consumers must tolerate unknown fields.
- The catalog is closed for v1. A plugin cannot publish topics; plugin-to-shell
  notifications use the protocol's request messages.

## 8. Resolved during ratification

1. `workspace/file-changed` does **not** carry the originating session. The save
   result is delivered before the event, so a plugin can treat the first event
   after its own save as the echo; adding a session field would leak another
   document's identity for no v1 benefit.
2. `theme/changed` carries the theme name only. Resolved CSS custom properties
   would create a second token contract and couple plugins to the shell's
   palette. A token set can be proposed later as its own contract.
3. A plugin with no matching open document has no handler frame and therefore no
   subscription in v1. Background frames are out of scope until a later layer
   needs them.
