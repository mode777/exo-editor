# Design

## Context

See [`proposal.md`](./proposal.md) for motivation and the spec deltas for
required behavior.

The current surfaces that matter:

- `shell/request-save` is the only shell-to-plugin request that changes a
  handler's buffer state, and it is one live request plus one queued request.
  `plugin/request-save` is the opposite-direction, id-less intent precedent.
- A handler frame owns its buffer. `HandlerSession` exposes the active phase,
  write capability and the frame boundary; `HandlerPool` maps one path to one
  session; `WorkspaceRuntime.saveActiveDocument` already gates a shell action on
  the active document.
- `EditorClient` subscribes to shell messages through `MessageGate`. Unknown
  shell message types are ignored, so an id-less addition is safe for older
  plugins.
- The shell handles `Ctrl/Cmd+S` in `App.tsx` because the workbench kit's
  `keybinding` field is display-only. Menu definitions are static and the
  command registry filters availability only for the palette; a menu entry
  outside its context is a no-op.
- Keyboard events inside a plugin iframe do not reach the shell document.
  `rendering: "frame"` editors therefore must bind their own keys; hidden
  handlers cannot receive keyboard focus at all.
- `apps/code-plugin` already lets Monaco own undo/redo when focused. It has no
  saved-text baseline, so today any model change reports dirty.

## Goals / Non-Goals

**Goals:**

- Give plugin-backed documents one standard Undo/Redo trigger without moving
  undo history or content into the shell.
- Make hidden handlers reachable from the menu, palette and shortcut.
- Keep the change additive: same protocol major, manifest schema, permissions,
  consent fingerprint and sandbox.
- Make the active-handler and writable checks testable in one place, with a test
  that fails when they are removed.

**Non-Goals:**

- A shell-owned undo stack, content snapshots, edit inversion or history replay.
- `canUndo`/`canRedo` state on the tab or in the shell.
- Undo/redo for the shell text surface, content views, panels or the browser
  toolbar. The textarea keeps its native undo.
- User-remappable keybindings or plugin-contributed keybindings.
- A generic editor-command bus. Only `undo` and `redo` are added.

## Decisions

### D1 - History stays in the plugin; the shell sends an intent

The plugin owns the buffer and therefore the history. The shell cannot invert an
edit without content, selection and editor-specific semantics it must never
hold. It sends a notification instead: the same responsibility split as save,
where the shell owns the action and the write while the plugin owns content
(D19).

Rejected: a shell-side stack of text snapshots (violates the no-content
invariant and cannot represent Monaco or a custom editor); a shell command that
focuses the iframe and synthesizes a key event (cross-origin frames cannot be
scripted and opaque-origin frames have no accessible document).

### D2 - Two id-less notifications, not requests or commands

Add to the protocol:

```text
shell/undo   { }   // id-less, no reply
shell/redo   { }   // id-less, no reply
```

Rules:

- Sent only to the active editor handler of the active document, in the editor
  phase, when the document is writable.
- No `id`, `replyTo`, content, version, timeout, queue or acknowledgement.
- Sent regardless of the dirty flag: the plugin's history may move the buffer
  away from a clean state or back to it.
- A plugin that does not implement them ignores the unknown id-less messages;
  no capability bit is needed because the shell does not need to know whether
  the plugin has history. An intent with no applicable history is a silent
  no-op.
- No `plugin/dirty` inference: the plugin reports the resulting state, as it
  already does for typing and saving.

Rejected: reusing `contributes.commands` with reserved ids (the command path has
a five-second cooldown, one in-flight invocation and a user-activation grant,
which makes repeated undo unusable and grants unrelated dialog authority);
a correlated request/result pair (there is nothing to return and a timeout would
be a second save-like policy); one `shell/history { action }` message (slightly
more extensible but less explicit and closer to a generic command bus).

### D3 - One shell routing path through the runtime

Add a path-scoped method on the handler pool and one active-document method on
the runtime:

- `HandlerSession.requestUndo()` / `requestRedo()` post the id-less messages
  when the session is active and writable.
- `HandlerPool.undo(path)` / `redo(path)` resolve the session for that path.
- `WorkspaceRuntime.undoActiveDocument()` / `redoActiveDocument()` read the
  active path and document, then require all of: `surface === "plugin"`,
  `pluginPhase === "active"`, a writable workspace, `document.readOnly` false
  and `editor.canWrite` true. Only then do they call the pool.

Keeping the checks in the runtime means the menu, palette and keyboard all
converge on one gate, and no surface can route to an inactive or read-only
handler. The handler session repeats the active/write check as defense in depth.

Alternatives rejected: routing from `DocumentStore` (it owns text documents and
save writes, not plugin handler commands); storing "active handler" separately
in the workbench store (the runtime already derives it from the active tab).

### D4 - No `canUndo`/`canRedo` tab state

The tab keeps only the existing `dirty` flag from `plugin/dirty`. The shell adds
no history depth, undo availability or redo availability. Reasons:

- The shell cannot know either value without a new plugin report on every
  history change, and the protocol has no state channel for it.
- The workbench menu definition has no disabled state; entries are static and a
  command that is unavailable is a no-op. A `canUndo` value would not change
  what the menu can render.
- The plugin already ignores an intent with no applicable entry, so the shell
  can send unconditionally.
- Dirty remains plugin-owned. A plugin that undoes back to the saved text
  reports `false`; the shell never compares content.

If a future UX needs disabled entries or history depth, a plugin-reported
history state is a separate change.

### D5 - Command surfaces and keyboard ownership

- Add an `Edit` menu with `Undo` and `Redo` and their shortcut labels. Menu
  entries are static; invoking them outside a writable plugin document is a
  no-op, matching the existing menu model.
- Add `exo.edit.undo` and `exo.edit.redo` to the command registry under the
  `Edit` category. The palette lists them only when the active document is a
  writable plugin document; `run` re-checks the same gate.
- Extend the existing window `keydown` handling for `Ctrl/Cmd+Z`,
  `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y`. Skip editable targets (`input`,
  `textarea`, `select`, `[contenteditable]`), open shell modal dialogs
  (`[role="dialog"][aria-modal="true"]`), already-prevented events and
  documents that are not writable plugin editors. Do not prevent the default
  until the runtime reports that it routed the intent.
- The shell text surface is not routed. Its uncontrolled textarea keeps native
  undo; `Ctrl/Cmd+Z` in a shell input keeps the input's native undo.
- A focused plugin iframe handles its own keys; the shell does not observe the
  event, so there is no double undo. A visible plugin that wants the keyboard
  path must bind its own keys; the shell intent is the menu/palette and
  hidden-handler path. This is documented for authors.

Rejected: intercepting the keydown at capture on `window` (iframe events never
reach it); adding a toolbar Undo/Redo button (redundant with the menu and
palette and adds shell state to a hidden handler's chrome).

### D6 - SDK, reference plugin and fixture

- `EditorClient` adds `onUndoRequest()` and `onRedoRequest()`, each returning an
  unsubscribe. They dispatch from `MessageGate` and send nothing. The SDK moves
  to `1.11.0`; protocol keeps `1`.
- The code plugin maps the intents to `editor.trigger('exo', 'undo' | 'redo',
  null)`. Monaco keeps its own in-frame keybindings. To make the dirty state
  accurate when undo returns to the saved text, the plugin keeps a saved-text
  baseline captured on load, on a successful save and on an external reload,
  and reports dirty from `model.getValue() !== savedText`.
- Add a hidden `**/*.history.txt` fixture mode. It loads the file, applies one
  local edit and immediately reports dirty, then applies `shell/undo` and
  `shell/redo` to a small in-memory history and records each action, the
  resulting buffer and the dirty report in `#observation`. This proves the
  menu/shortcut reaches a handler that cannot receive focus.

### D7 - Tests bind the new behavior to the existing invariants

- Handler: posts exactly one id-less message for an active writable session; a
  mounting, disposed or read-only session posts nothing.
- Runtime: routes only for the active writable plugin document; an inactive
  tab, shell text document, read-only document, mounting/failed handler or
  workspace switch sends nothing. The active/writable guard has a removal test.
- Commands and menus: palette availability and no-op behavior; Edit menu
  entries; `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` routing; editable
  shell targets are ignored.
- SDK: listeners fire once per message, unsubscribe, no reply and no state
  change; disposal closes them.
- Reference plugin and fixture: shell undo and redo change the buffer, dirty
  follows the saved baseline, and save still writes the exact current text.

## Risks / Trade-offs

- **The Edit menu shows Undo/Redo on text documents and does nothing** → The
  palette hides them there, the textarea keeps native undo, and the guide states
  the limitation. A shell text history is a separate change.
- **A visible plugin that does not bind keys has no keyboard undo while the
  iframe owns focus** → The guide states that a visible editor must bind its own
  keys; the shell route covers the menu, palette and hidden handlers.
- **Older plugins receive an unknown shell message** → The protocol already
  ignores unknown id-less types; the SDK does not open a pending request and
  the plugin keeps its current state.
- **The plugin reports dirty incorrectly after undo** → Dirty is already
  plugin-owned and trusted. The reference plugin and fixture verify the
  saved-baseline behavior; the shell never infers it.
- **Undo during an in-flight save** → The save still writes the content returned
  for its live request, a later undo is just another buffer change, and the
  existing dirty-sequence rule keeps the tab dirty. No second write is started.
- **Key auto-repeat sends many intents** → Each keydown is one intent; the
  plugin applies or ignores each one, and no shell queue or coalescing is
  needed because undo is not a write.
- **No disabled menu state** → Entries stay visible and no-op. A future kit or
  state channel can refine this without changing the protocol.

## Migration Plan

Additive and deployed with the shell. The shell accepts the same protocol major
and manifest schema; third-party plugins keep working and simply ignore the new
messages until they add listeners. The reference plugin and fixture ship in the
same deployment. Rollback is a shell-only revert; no workspace data, consent
record or manifest changes with this feature.

## Deployed Verification

Pending. Record the deployed commit, date, fixture URLs and observations
(menu, palette, shortcuts, hidden handler, text surface and dirty transition)
during apply.
