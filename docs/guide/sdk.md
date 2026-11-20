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

To discover files in a directory, declare `workspace:list` and page through the
listing:

```ts
if (editor.capabilities.directoryListing) {
  let cursor: string | undefined
  do {
    const page = await editor.listDirectory('.', cursor ? { cursor } : {})
    for (const entry of page.entries) {
      if (entry.kind === 'file') {
        // `entry.path` is workspace-rooted; content still comes from readFile.
        const content = await editor.readFile(entry.path, 'utf8')
        // Use the path and content.
      }
    }
    cursor = page.nextCursor
  } while (cursor)
}
```

The SDK rejects locally with `unsupported-message` when
`capabilities.directoryListing` is absent and with `permission-denied` when the
manifest lacks `workspace:list`. Pass `nextCursor` through unchanged; the SDK
does not define its format. Listing is one level at a time: list a returned
directory with another call. Keep exact-path reads and the picker as the
fallback on an older shell.

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

## Panels and content views

Declare them in the manifest, register the ids you want active, then build the
view page with the same SDK:

```ts
// controller
registration.registerPanel('outline')
registration.registerContentView('tutorial')

// views/outline.ts
const connection = await connectBrowserPlugin()
if (connection.mode !== 'view') throw new Error('Expected a view frame')
const view = connection.view
view.onDispose(() => cleanup())
await view.readFile('/notes.txt')
await view.requestPanel('outline', 'toggle')
await view.openView({ viewId: 'tutorial', instanceKey: 'chapter-2', payload: { chapter: 2 } })
```

`ViewClient` exposes reads, listings, the picker, events and the navigation
helpers, and no save or dirty methods. `view.kind` is `panel` or `content`;
`view.payload` and `view.openedBy` are one-shot data. A view must name a
`/`-rooted path for `openFile`. Panels mount on first reveal; content views open a
tab per instance key.

## Commands

Register the command ids you want active, then attach one handler in the frame
that will receive them:

```ts
// controller
registration.registerCommand('format')
registration.registerCommand('generate')

// editor or view page
connection.editor.onCommand(async ({ command, args }) => {
  if (command === 'format') return { ok: true }
  if (!args) return { ok: false, message: 'This command needs an explorer selection.' }
  await runReport(args.path, args.kind)
})
```

The SDK answers every invocation automatically: a resolved handler is success, a
thrown error or `{ ok: false, message }` is a bounded failure, and the shell
shows the failure as a non-blocking notice. Up to ten commands that arrive before
you attach a handler are queued. Check `supportsCommands` when you also support
older shells; it is false when `capabilities.commands` is absent.

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

### Messaging between your own frames

Each open document has its own handler frame. To share state between them, use a
local topic; the shell scopes it to your plugin identity, so another plugin using
the same name never sees it.

```ts
// Every editor frame subscribes once after connecting.
const sessionId = editor.initialization.sessionId
await editor.subscribeLocal('local/selection')
editor.onLocalEvent('local/selection', (event) => {
  if (event.from === sessionId) return // ignore your own event
  renderSelection(event.payload)
})

// When the user changes the selection, tell the sibling frames.
await editor.publishLocal('local/selection', { path: editor.file.path, start, end })
```

`publishLocal()` resolves when the shell accepted the event; it does not mean a
peer handled it. Keep your own request/reply correlation id in the payload if you
need replies. A late-joining frame receives the current sequence and only later
events, so ask a peer for current state or carry it in `shell/init`/the workspace.
`localEvents` is a support bit: on a shell that omits it, the SDK rejects local
calls with `unsupported-message` before sending anything.

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
