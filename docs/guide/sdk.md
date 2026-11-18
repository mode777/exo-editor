# SDK

`@exo/plugin-sdk` is the typed plugin client. It owns the envelope, handshake,
registration, file-handler and event plumbing, including the origin and session
checks. The normative package surface and compatibility policy are in
[`docs/contracts/plugin-sdk.md`](../contracts/plugin-sdk.md) and the package
[README](../../packages/plugin-sdk/README.md).

In v1 the package is private to this repository and consumed as TypeScript
source. The template and code plugin import it through the npm workspace; a
plugin outside this repository uses the same source layout until a published
package exists (see [`docs/releases.md`](../releases.md)).

## Controller

```ts
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'

const connection = await connectBrowserPlugin()
if (connection.mode !== 'register') throw new Error('Expected register mode')

connection.registration.register({
  glob: '**/*.md',
  entry: 'editor.html',
  label: 'Markdown',
})
const ack = await connection.registration.complete()
```

`connectBrowserPlugin` reads `exo-host`, `exo-mode` and `exo-session` from the
fragment. It refuses a top-level page, never posts to `*`, and drops messages
from a source or origin that is not the shell. The controller page does not
need a `message` listener of its own.

## Editor

```ts
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'

const connection = await connectBrowserPlugin()
if (connection.mode !== 'editor') throw new Error('Expected editor mode')

const editor = connection.editor
let buffer = ''
let dirty = false

function markDirty(value: boolean) {
  dirty = value
  editor.setDirty(value)
}

editor.onSaveRequest(() => ({ text: buffer }))
editor.onFileChanged((change) => {
  if (change.kind === 'changed' && !dirty) void reload()
})
editor.onDispose(() => {
  // Cancel timers, workers and fetches here.
})

async function reload() {
  const content = await editor.readFile(editor.file.path, 'utf8')
  buffer = content.text
  markDirty(false)
}

await reload()
```

To let the user pick a workspace file instead of typing a path:

```ts
if (editor.capabilities.filePicker && editor.capabilities.requestFiles) {
  const paths = await editor.requestFiles({ multiple: false })
  if (paths.length > 0) {
    const content = await editor.readFile(paths[0], 'utf8')
    // Use the picked path and its content.
  }
}
```

The helper resolves `[]` when the user cancels. It sends no content; read a
selected path with `readFile`. If `filePicker` is missing (an older shell), it
rejects locally with `unsupported-message`, so keep manual path entry as the
fallback. `directory` is an optional start hint, not a permission.

Rules the SDK enforces for you:

- `shell/init` must echo the fragment's session and mode before any payload is
  exposed.
- `readFile` correlates replies and rejects pending reads on disposal.
- `requestFiles` preflights the support and permission bits and rejects a second
  pending picker locally; the shell still serializes pickers globally.
- The save handler is the only way content leaves the editor; return
  `{ text }` or `{ bytes }` from `onSaveRequest`.
- `plugin/dispose-ack` is sent automatically; after dispose, later messages are
  ignored.
- A throwing listener does not break the connection.

## Events

```ts
if (editor.initialization.permissions.includes('events:subscribe')) {
  await editor.subscribe('theme/changed')
  editor.onEvent('theme/changed', (event) => {
    applyTheme(event.payload.theme)
  })
}
```

Subscriptions are per handler frame and require the manifest's
`events:subscribe` permission. Initial state is in `shell/init`; events are
changes, not a replay. See [`docs/contracts/events.md`](../contracts/events.md).

## Errors

`ExoProtocolError` carries a stable code. A protocol major mismatch includes
`expected` and `received`. Catch it at boot and show an actionable message; do
not retry with a different version or hand-craft a reply. The shell may also send
a `shell/error` without a `replyTo` (for example `rate-limited`); expose it to
your error UI without closing the editor.

## Testing without a browser

```ts
import { connectPlugin, type PluginTransport } from '@exo/plugin-sdk'

const connection = await connectPlugin({ transport })
```

`FakePluginTransport` from `@exo/plugin-sdk/testing` records posts and injects
messages with an explicit origin and source. It is what the SDK and shell
conformance suites use. See [testing](./testing.md) for the end-to-end checks.
