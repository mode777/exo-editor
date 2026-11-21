# Design

## Context

See `proposal.md` for motivation and the three delta specs for normative
behavior. The current implementation already provides the seams this feature
needs:

- `HandlerSession` owns one editor frame's protocol state, the read path and
  disposal. It receives the `WorkspaceSession` and the candidate manifest.
- `HandlerPool` owns every handler frame, the per-document visible surface
  (`attachSurface`) and the teardown order. A hidden contribution never has a
  surface; the active visible document does.
- `WorkspaceSession.forPlugin(pluginId).list()` already filters reserved entries
  and attributes denials to the plugin.
- The shell has a modal/focus-trap pattern (`useModalDialog`) and existing
  dialog surfaces for consent, remote connect and "Open with".
- The SDK already exposes `capabilities.requestFiles`, but no message uses it.
  Older shells set that bit from `workspace:read`, so it cannot be used as a
  support check.

## Goals / Non-Goals

**Goals:**

- Let an active visible editor ask the user to select workspace files without
  giving the plugin discovery, content or handles.
- Reuse the existing workspace facade, read path and modal/accessibility
  patterns rather than adding a second filesystem path or tree implementation.
- Make the feature detectable and degradable: old shells and old plugins keep
  working, and a new plugin has a manual-path fallback.

**Non-Goals:**

- Directory listing, recursive traversal, globbing or search. Those belong to
  the separate workspace-listing change.
- Returning content, stats, versions or handles from the picker.
- A new permission, manifest field or consent-fingerprint input.
- Picker use from hidden, inactive or unfocused handlers.
- Plugin-supplied picker text, default selection or arbitrary UI.
- A new native browser picker or a second filesystem provider.

## Decisions

### D1 - The picker is a shell modal over the plugin-scoped workspace facade

The picker is a React shell surface, not a browser file input and not plugin
HTML. It lists directories lazily with
`session.forPlugin(pluginId).list(path)` and therefore shares normalization,
containment, reserved-path filtering and denial logging with the handler read
path. It never calls the shell-side session, which could see `/exo.json` or
`/.exo/**`.

Alternatives: a native `showOpenFilePicker` (does not return a workspace path and
can reach outside the workspace); a plugin-rendered picker (would require the
content/listing API and would give the plugin the tree); a new picker-specific
workspace method (duplicates the facade for no benefit).

### D2 - New support bit, not a reinterpretation of `requestFiles`

Editor `shell/init` gains `capabilities.filePicker`. `requestFiles` remains the
permission bit derived from `workspace:read`. A new shell sends
`filePicker: true`; older shells omit it. The SDK parser defaults the missing
field to `false`, and `requestFiles()` checks both bits before sending.

This avoids the compatibility trap where an old shell says
`requestFiles: true` but has no message. A plugin can show its picker action only
when `filePicker` is true, and can still fall back to manual path entry when it is
false.

Alternatives: add a general `features` array (more future-proof but a second
shared protocol change); treat `requestFiles` as the support bit (silently
breaks against deployed shells); infer from `shell.version` (the contract
forbids it).

### D3 - Paths only, empty array means cancel

The reply is `shell/files-selected { paths: WorkspacePath[] }` with `/`-rooted
workspace paths. An empty array is the user's cancellation. The plugin reads
each path through the existing `plugin/request-file`, so permission, containment,
reserved-path, size and caching rules stay in one place.

The picker does not return a version, stat, `FileSystemHandle`, `File` or
`Blob`. It does not read file bytes. A selected path may disappear before the
plugin reads it; that read fails with `not-found`, which is the existing
behavior.

Alternatives: return `FileStat[]` (over-shares metadata and invites plugins to
depend on versions they cannot use); return content directly (duplicates the read
path and bypasses limits); add an `aborted` error for cancellation (turns a
normal user action into an error and adds a protocol code).

### D4 - One picker globally, gated on the active visible focused handler

`HandlerPool` already knows whether a document has a visible surface. The
request path checks, in order:

1. the handler session is active and not disposing;
2. the contribution is `rendering: "frame"` and `HandlerPool.surfaces` has the
   path, which means the document area is currently showing this handler;
3. the frame reports focus (`document.activeElement` is its iframe) so a
   background or hidden frame cannot pop a modal;
4. no other picker is open.

The focus check is the closest enforceable proxy for a user gesture across
`postMessage`. The contract does not claim the shell can verify a real click;
the user still has to select a path, so a false positive only shows a picker and
grants nothing. This needs a small `FrameHandle` focus accessor (or an injected
focus predicate) so the protocol layer does not read the DOM directly; the fake
transport returns a controllable value in tests.

A `FilePickerController` owns the single pending request. It rejects a second
request with `rate-limited`; it does not queue one, because a queue invites
modal spam. The controller is workspace-scoped and is cancelled by the handler's
`AbortSignal` on disposal, by `attachSurface(path, null)` when the document
leaves the active area, and by workspace detach.

Alternatives: one picker per frame (multiple editors can stack modals); no focus
gate (a background script can pop a picker); no focus but a timer/gesture
heuristic (not observable from the shell).

### D5 - Fixed disclosure and the existing modal pattern

The dialog uses `useModalDialog` and the shell's dialog styles. It displays the
plugin `name` and `id` in shell-owned text and states that the plugin can read
the selected files. The request cannot carry a title, message, description or
preselected path. The only request-specific display data is `multiple` and an
optional starting directory.

The picker is a file-only selection. Directory navigation is exposed as rows and
breadcrumbs, not as selectable directory results. `multiple` is capped at 32
paths; the picker enforces the cap even if the request asks for more.

The starting directory defaults to the handler file's directory. A request may
carry `directory`; the shell normalizes and contains it, and silently falls back
to the handler directory if it is missing, reserved or invalid. It is a hint,
not a grant.

Alternatives: let the plugin supply a prompt (phishing surface); start at the
workspace root (worse UX for sibling assets); allow directory selection (would
need a separate directory-grant model).

### D6 - Additive SDK helper with local preflight

`EditorClient.requestFiles(options?)`:

- rejects locally with `unsupported-message` when `capabilities.filePicker` is
  false or absent;
- rejects locally with `permission-denied` when `capabilities.requestFiles` is
  false;
- rejects locally with `rate-limited` when the client already has a pending
  picker;
- otherwise sends one `plugin/request-files` with a fresh id and resolves with
  the selected paths as a `string[]` from the matching `shell/files-selected`;
- rejects that request with `protocol-violation` if the reply shape is invalid;
- lets the normal `shell/dispose` path reject a pending picker with `closed`.

The SDK version becomes `1.2.0`; the protocol major stays `1`. No new SDK error
code is needed: `unsupported-message` already means "this shell does not speak
that message", and `permission-denied`/`rate-limited` are existing codes.

Alternatives: send and wait for `unsupported-message` (works but makes a plugin's
UI flash or fail late); add a new `unsupported` client code (unnecessary surface).

### D7 - No consent-fingerprint change

The plugin already needs `workspace:read` to read a selected path. The picker adds
no autonomous access: the user sees the shell dialog and chooses each path. The
existing consent text for `workspace:read` should be clarified to say the plugin
can read other workspace files it requests, but the fingerprint inputs do not
change and no re-prompt is required.

Alternatives: add a manifest field just to announce picker support (the support
bit is a shell capability, not a plugin capability); add a permission (would
re-prompt every reader for a user-mediated action).

## Risks / Trade-offs

- **Old shells advertise `requestFiles: true` but cannot answer.** → Gate the SDK
  on `filePicker`, default absence to false, and keep manual entry as the
  documented fallback. A test must cover the old-init shape.
- **Focus is a heuristic, not a verified gesture.** → A false positive only opens
  a picker; the user still selects the path. Keep the gate plus one global
  picker.
- **Picker spam or modal stacking.** → One global controller, one pending picker
  per frame, `rate-limited` without queueing, and focus/active gating.
- **A reserved path changes between listing and selection.** → Re-check
  `isReservedPath` immediately before replying and return no path.
- **A large directory makes the picker slow.** → Lazy listing, virtualized rows
  and the existing 10k-directory performance budget; no eager recursive walk.
- **Workspace switch races the dialog.** → Abort the pending request, close the
  dialog before the session is released, and let the handler's phase check drop
  any late continuation.
- **Selected paths in logs.** → Log the plugin id and outcome, not selected
  paths, in the plugin log; the workspace facade continues to log its own list
  operations.
- **A hidden editor cannot use the picker.** → This is intentional; the consumer
  must declare `rendering: "frame"` or the shell needs a future command surface.

## Migration Plan

1. Deploy the shell change first. Existing plugins ignore the new capability and
   message.
2. Publish the SDK `1.2.0` helper. A plugin built with it detects `filePicker`
   and degrades to manual path entry on older shells.
3. Update the contract, guide and fixture plugin in the same change. No manifest,
   consent, storage or workspace-data migration is needed.
4. Rollback is the shell deploy; the message and capability are additive, so
   older plugins are unaffected.

## Verification

Deployed on 2026-11-18 at commit `a868f08`
(`https://mode777.github.io/exo-editor/`) in Chrome Headless Shell
131.0.6778.264. The workspace was an OPFS handle exposed through the same
`showDirectoryPicker` stub as the layer 5-10 checks, containing
`picker.picker.txt`, `a.txt`, `plain.txt`, `textures/albedo.png` and an
`exo.json` that declares the deployed fixture manifest.

- The picker fixture's button opened the dialog only after the iframe/button was
  focused. A programmatic click without focus produced `permission-denied` in
  the fixture observation, which is the intended active/focused gate.
- The dialog named the plugin, listed `textures/`, `a.txt`,
  `picker.picker.txt` and `plain.txt`, and showed neither `exo.json` nor `.exo`.
  Arrow Down moved focus between rows; Escape cancelled and recorded
  `picks: [{ paths: [] }]`.
- A second request from the same fixture while the dialog was open recorded
  `rate-limited` without opening a second dialog.
- Selecting `a.txt` produced `picks: [{ paths: ["/a.txt"] }]` (paths only), the
  fixture received the content through `plugin/request-file`, appended
  `[fixture picked /a.txt]` and reported dirty. Save wrote exactly
  `picker document\n[fixture picked /a.txt]\n[fixture save 1]` to OPFS.
- A tab switch and a tab close while the dialog was open closed it silently
  without adding an empty `picks` entry. A raw picker request from the hidden
  `a.txt` handler received `permission-denied`.
- Disabling the fixture through `exo.json` and a focus refresh closed the open
  dialog and disposed the handler. Switching to a second OPFS workspace
  (`exo-switch-ws`) closed the dialog, mounted the new workspace and left no
  plugin iframe. Headless CDP cannot click through the open modal, so the test
  temporarily hid the dialog backdrop to reach Open Folder; the pending request
  itself remained open until the switch reset it.
- Old-shell fallback is covered by the SDK tests: a missing `filePicker` bit
  parses as `false` and `requestFiles()` rejects locally with
  `unsupported-message` without sending a message.

## Open Questions

None that change the specs or task breakdown. Future work may add extension
filters or a shell command that lets a hidden handler request a picker; both are
additive and deliberately out of scope here.
