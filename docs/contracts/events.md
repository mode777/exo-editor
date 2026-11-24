# Plugin Events Contract (v1)

Status: ratified by the OpenSpec change `define-core-contracts`. Normative
requirements are mirrored in `openspec/specs/plugin-events/spec.md`.

## 1. Purpose

Shell-to-plugin notifications - theme changes, file changes, workspace closure,
plugin configuration - travel over a topic subscription API carried by the same
envelope as the plugin protocol. The same bus also carries **plugin-local**
events between the frames of one plugin: `local/<name>` topics are scoped to a
single plugin identity, so two plugins may use the same name without observing
each other. Workspace-wide notifications use topics only; the targeted
`shell/file-changed` message for an open document (section 5.4 of
[`plugin-protocol.md`](./plugin-protocol.md#54-external-changes)) stays a
protocol message and is not a second subscription channel. Both forms derive
from the same observation.

Events are **push, not RPC**: a topic has no request/response pair, the shell
does not wait for a plugin to handle one, and a slow plugin cannot block another.

## 2. Subscription messages

```text
plugin/subscribe    { topic: string }
plugin/unsubscribe  { topic: string }
plugin/publish      { topic: string, payload: unknown }
shell/subscribed    { topic: string, seq: number } | { topic, code: 'unsupported-topic' }
shell/published     { topic: string, seq: number }
shell/event         { topic: string, seq: number, from?: string, payload: unknown }
```

- `plugin/subscribe` is idempotent. Re-subscribing returns the current `seq`.
- `PluginPermission` `events:subscribe` is required for shell subscriptions and
  for local publication and subscription; without it the shell replies
  `permission-denied`.
- `plugin/publish` is correlated: it carries a request id and the shell replies
  `shell/published` with the accepted topic and sequence. The reply means the
  shell accepted the event, not that a peer handled it.
- `config/changed` is targeted: only the subscribed handler and view frames of the
  plugin named in the payload receive it. A frame of another plugin receives
  neither the event nor the values, even if it subscribes to the topic.
- Unknown topics are rejected with `unsupported-topic`; the shell does not
  wildcard-match topics. A shell topic sent through `plugin/publish` is rejected
  with `permission-denied` and does not advance that topic's sequence.
- Subscriptions belong to a frame. They are not persisted and do not survive
  `shell/dispose`.
- Only handler and view frames may subscribe or publish. A registration frame is
  too short-lived and a view frame carries the same identity, permission, queue
  and sequence rules as a handler. A plugin that needs events without any open
  document or view still needs a background frame, which is not part of v1. A
  panel is retained while it is registered, so it can act as the plugin's
  event hub until the plugin stops or the workspace switches.

### Local topic rules

- `local/<name>` is reserved for plugin-authored topics. The name is 1-64
  characters of lowercase letters, digits, dots, underscores or hyphens and
  starts with a letter or digit. `local/`, `local/State`, `local/a/b` and a name
  longer than 64 characters are rejected with `unsupported-topic`.
- A local subscription and its sequence are keyed by `(plugin identity, topic)`.
  The plugin identity includes the manifest origin and id, so two plugins with
  the same id on different origins are separate. Delivery filters on that
  identity and never routes to another plugin.
- A local event carries `from`, the publishing frame's opaque `exo-session`.
  The shell sets it; a plugin cannot forge another frame's id through the
  payload.
- A publisher that is also subscribed receives its own event. There is no
  ordering guarantee between `shell/published` and delivery to the publisher.
- The shell does not interpret, log or persist the payload. Plugins own their
  payload shapes and should include a correlation id for request/reply patterns.
- Local topics share the 32-topic per-frame budget with shell topics.

## 3. Event shape

```ts
interface ShellEvent<T> {
  topic: string
  /** Monotonic per workspace session and topic; resets on workspace switch. */
  seq: number
  /** Local events only: the publishing frame's opaque exo-session. */
  from?: string
  payload: T
}
```

- Shell sequences are per topic per workspace session. Local sequences are per
  plugin identity and topic, so two plugins using `local/state` each start at 1.
- `seq` starts at 1 for the first event a frame receives after subscribing; the
  `shell/subscribed` reply carries the current value so a plugin can detect a
  gap. With one subscriber per topic this is enough; the shell makes no
  cross-topic ordering promise.
- Delivery is at-most-once. A dropped event is not replayed.
- The shell delivers to every live frame of every plugin subscribed to a shell
  topic, independently, and to every subscribed frame of the same identity for a
  local topic. One plugin's failure to process does not affect another.
- Event payloads must be structured-cloneable and contain no functions, handles
  or DOM nodes.

## 4. Topic catalog (v1)

| Topic                    | Payload                                                                                        | When                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `theme/changed`          | `{ theme: 'dark' \| 'light' \| 'high-contrast' }`                                              | The user changes the shell theme                                                                         |
| `workspace/file-changed` | `{ path, kind: 'created' \| 'changed' \| 'deleted' \| 'renamed', version? }`                   | A file in the workspace changes, including saves from other tabs                                         |
| `workspace/closed`       | `{ reason: 'switch' \| 'close' }`                                                              | The workspace is being released; the last event a frame receives                                         |
| `config/changed`         | `{ pluginId, values: Record<string, unknown> }`                                                | A plugin's contributed settings change; only that plugin's subscribed handler and view frames receive it |
| `view/active`            | `{ pluginId, active: false }` or `{ pluginId, active: true, viewId, instanceId, instanceKey }` | A plugin's active content-view tab changes or clears; only that plugin's subscribed frames receive it    |

Topic names are `<namespace>/<event>`, lowercase, `[a-z0-9-]` segments, maximum
64 characters. New topics are added by changing this contract and the OpenSpec
spec; a plugin must ignore topics it does not know.

### Plugin-local namespace

`local/<name>` is not part of the shell catalog. It exists only for the frames
of one plugin and is governed by the local rules in section 2. A plugin cannot
add a shell topic, cannot publish a shell topic, and cannot observe another
plugin's local topic. `config/changed` and `view/active` are the targeted shell
topics.

`config/changed` carries the full new value map for the named plugin, not a
delta. It requires `events:subscribe`, and the shell delivers it only to that
plugin's live handler and view frames. A plugin without the permission, or with
no live frame, gets the current values from `shell/init` the next time a frame
mounts. Settings are shell-owned; no other plugin can read them through this
topic.

`view/active` carries the plugin's active content-view instance. An active event
includes `viewId`, `instanceId` and `instanceKey`; a clear event carries only
`{ pluginId, active: false }`. It requires `events:subscribe`, is delivered only
to that plugin's subscribed frames, and is published when the active tab changes.
The current value at frame start is in `shell/init.activeContentView`; the event
is a change notification, not a replay.

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

| Limit                                     | Value                                     |
| ----------------------------------------- | ----------------------------------------- |
| Topics per frame                          | 32 across shell and local namespaces      |
| Queued events per topic per frame         | 1000                                      |
| Event payload                             | 1 MiB (shell and local)                   |
| Shell publish rate per topic              | 100 events/s (coalesced topics may burst) |
| Local publish rate per identity and topic | 100 events/s                              |
| Local publish rate per frame              | 200 events/s across all local topics      |

- On queue overflow the shell drops the oldest events and sends one
  `shell/error` with `rate-limited` and the topic name. It does not tear down the
  frame for overflow. The queue is drained in a microtask and is a burst bound,
  not backpressure: `postMessage` has no acknowledgement.
- Non-coalesced topics publish at most 100 events per rolling second; events
  beyond that are dropped and not replayed. Coalesced file changes are exempt
  from that gate because they are already merged per path.
- A local publication over the 100/s topic rate or the 200/s frame aggregate is
  rejected with `rate-limited`; no event is delivered for it and the frame is not
  torn down.
- A local payload over 1 MiB is rejected with `too-large` and a message naming
  the limit; the sequence does not advance.
- A frame that repeatedly sends invalid subscription or publication messages is
  treated as a protocol violation under
  [`plugin-protocol.md`](./plugin-protocol.md#6-errors).
- Event publication must never throw into the shell's render path. A failing
  subscriber is logged and removed from the delivery set after three failures.

## 7. Versioning

- Topics are versioned by name only (`theme/changed`, not `theme/changed.v2`).
  A breaking payload change ships under the same topic only with a protocol
  major bump, because plugins and shell are deployed independently.
- Additive payload fields are allowed; consumers must tolerate unknown fields.
- The shell catalog is closed for v1. A plugin cannot publish shell topics;
  plugin-to-shell notifications use the protocol's request messages. The only
  plugin-published topics are in the reserved `local/` namespace, whose payloads
  the shell treats as opaque.

## 8. Resolved during ratification

1. `workspace/file-changed` does **not** carry the originating session. The save
   result is delivered before the event, so a plugin can treat the first event
   after its own save as the echo; adding a session field would leak another
   document's identity for no v1 benefit.
2. `theme/changed` carries the theme name only. Resolved CSS custom properties
   would create a second token contract and couple plugins to the shell's
   palette. The optional SDK token sheet in
   [`plugin-styling.md`](./plugin-styling.md) is a plugin-local palette, not a
   protocol payload; `theme/changed` still carries only the name.
3. A plugin with no matching open document has no handler frame and therefore no
   subscription unless it has registered and revealed a panel, which is retained
   as its event hub. Background frames remain out of scope until a later layer
   needs them.
