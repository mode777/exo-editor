# Plugin Events Contract (v1)

Status: ratified by the OpenSpec change `define-core-contracts`. Normative
requirements are mirrored in `openspec/specs/plugin-events/spec.md`.

## 1. Purpose

Shell-to-plugin notifications - theme changes, file changes, workspace closure,
plugin configuration - travel over a topic subscription API carried by the same
envelope as the plugin protocol. There is no second channel and no polling.

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
| `config/changed` | `{ pluginId, values: Record<string, unknown> }` | A plugin's contributed settings change |

Topic names are `<namespace>/<event>`, lowercase, `[a-z0-9-]` segments, maximum
64 characters. New topics are added by changing this contract and the OpenSpec
spec; a plugin must ignore topics it does not know.

`config/changed` is part of the v1 catalog but has no producer until the plugin
settings layer ships. Subscribing to it before then is valid and silent; current
values are still delivered in `shell/init` once settings exist.

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

## 5. Initial state

The shell does not replay a history. `shell/init` carries the current `theme`,
`workspace.name` and the plugin's settings values, so a frame can render without
subscribing. `config/changed` is then incremental.

## 6. Limits and failure

| Limit | Value |
| --- | --- |
| Topics per frame | 32 |
| Queued events per topic per frame | 1000 |
| Event payload | 1 MiB |
| Publish rate per topic | 100 events/s (coalesced topics may burst) |

- On queue overflow the shell drops the oldest events and sends one
  `shell/error` with `rate-limited` and the topic name. It does not tear down the
  frame for overflow.
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
