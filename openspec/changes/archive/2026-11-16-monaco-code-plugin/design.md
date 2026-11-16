# Design

## Context

See `proposal.md` for motivation and the delta specs for normative behavior. The
implementation builds on the layer 5-8 code and must not weaken it:

- `DocumentStore` already routes a matching document to a `HandlerPool`, keeps
  dirty state from `plugin/dirty`, serializes saves and reacts to external
  changes. `DocumentArea` renders the tab chrome and the shell textarea.
- `HandlerPool` opens every handler through `FrameTransport`. `DomFrameTransport`
  appends hidden iframes to a body-level container; the workbench preset unmounts
  the document body on a tab switch, so a React-owned iframe cannot hold a
  session.
- `PluginManifest` validates `contributes.fileEditors` with an allow-list of
  fields, and `consent.ts` hashes the id, origin, root, permissions and editor
  globs/priorities. `EditorCandidate` carries the resolved contribution to the
  registry.
- `@exo/plugin-sdk` already exposes browser bootstrap, registration, editor
  reads, dirty, save, file-changed, dispose and events. No wire message changes.
- CI builds only the shell, runs the budget, CSP, custom-element and no-SDK
  checks, then builds and copies the template child path before uploading
  `apps/shell/dist`.

## Goals / Non-Goals

**Goals:**

- Make an interactive third-party editor possible without an editor-specific
  shell branch, a second protocol implementation or a shell DOM handoff.
- Keep registration frames hidden and keep every handler frame sandboxed exactly
  as before.
- Build and deploy the Monaco plugin as a normal child-path plugin, with the
  shell bundle unchanged in size and dependencies.
- Keep the existing headless template and fixture behavior the default.

**Non-Goals:**

- Rendering plugin UI into the shell DOM, moving the iframe in and out of React,
  or creating a second handler for a document.
- A plugin-initiated save message; the shell remains the save initiator.
- LSP, language servers, remote completion, telemetry or a Monaco CDN.
- Making every handler visible, or changing the sandbox/consent model for
  storage.

## Decisions

### D1 - Opt-in `rendering` field, default hidden

`contributes.fileEditors[].rendering` is `"hidden" | "frame"`, default
`"hidden"`. The registry carries the value to the handler candidate. A `"frame"`
contribution is displayed in the document area; `"hidden"` preserves the
template, fixture and existing manifests unchanged.

Alternatives: make every handler visible (breaks the headless template contract
and exposes debug pages); infer visibility from the entry page or a query
parameter (undocumented, hard to fingerprint, and a plugin could self-promote
without consent); grant Monaco a special case (the forbidden privileged path).

### D2 - Display the existing body-level iframe; do not reparent it

The handler keeps living in the `DomFrameTransport` container. For a frame
contribution, `FrameHandle` exposes an optional surface controller with
`show(bounds)`, `hide()` and `close()`. `DocumentArea` renders an empty,
measured slot for the active plugin document; the pool observes its bounds with
`ResizeObserver` plus a window resize listener and sets the iframe's fixed
position and size. A tab switch unmounts the slot and hides the iframe, but the
session and browsing context stay alive. Returning to the tab re-measures and
shows the same frame.

The visible iframe is `position: fixed` over the slot, not inside the React tree.
That avoids a reparenting reload, keeps the hidden-frame container as the only
owner of frame lifetime, and lets the shell header, Save button, banners and tab
strip stay outside the plugin rectangle. Hidden frames keep `display: none`, no
tab focus and `aria-hidden="true"`; the visible frame gets a title and normal
focus behavior.

Alternatives: move the iframe into the slot (browsers may reload a reparented
iframe, destroying the session); keep a second visible iframe (two sessions and a
content-sync protocol); make the document area itself persist every tab (the
preset only renders the active tab and changing that forks the workbench).

### D3 - Visibility is presentation, not a protocol or capability change

No new message, envelope field, timeout or capability is introduced. The
manifest value selects whether the shell presents the frame. The iframe keeps
the sandbox computed from its origin, the same origin/source checks, the same
`postMessage` target rule and the same hidden registration lifetime. The consent
fingerprint includes the frame flag only when it is `"frame"`, so existing
manifests keep their fingerprints and a hidden-to-visible change re-prompts.

Alternatives: add a `shell/show-frame` message (a second way to express
manifest state and a runtime race); include `"hidden"` in the fingerprint for
every manifest (forces every existing user to re-consent for no surface change).

### D4 - Monaco is bundled in the plugin, with inline workers

`apps/code-plugin` depends on `monaco-editor` and imports the full editor API so
TypeScript, JavaScript, JSON, CSS and Markdown tokenization and the built-in
JSON/TypeScript workers are available. Vite builds the plugin with
`worker.format: 'es'` and `?worker&inline` imports. Workers are therefore created
from inline data/blob URLs rather than a same-origin URL that an opaque-origin
same-origin frame cannot fetch. No CDN, loader script, `eval` or server is used.

There is no language server: Monaco's local text model and bundled language
services provide highlighting and basic JSON/TypeScript syntax. The shell never
sees a Monaco API or a model.

Alternatives: `@monaco-editor/loader` from a CDN (adds a network dependency and
breaks the static/offline rule); separate worker files (likely blocked by the
opaque origin of a same-origin sandboxed frame); `monaco-editor-core` only
(loses JSON/TypeScript support the roadmap asks the plugin to demonstrate).

### D5 - The plugin surface owns editor UI and a status strip

The editor page fills its viewport with a Monaco editor and a small status strip
(path, language, dirty/save state, external-change notice, large-file message).
It never tries to imitate shell chrome. The shell still renders the tab,
breadcrumbs, file size, editor label, Save button and read-only/conflict banners
outside the iframe. The plugin reads the file once through the SDK, tracks model
changes with a generation counter, reports dirty, answers saves with the exact
model text, and clears dirty only when no edit happened after the save request.
An external change marks the plugin surface and asks the user to reload when the
buffer is dirty; the shell's existing reload action disposes and remounts the
handler.

The shell's Save action is the save entry point in v1. Keyboard events inside the
iframe do not reach the shell and the protocol has no plugin-initiated save
message, so Ctrl+S inside Monaco is not wired to the shell. This is documented
rather than adding an undocumented message in this layer.

Alternatives: add `plugin/request-save` (a protocol change with correlation and
serialization work outside this layer); mirror keys through the shell (impossible
across a sandboxed iframe without a message anyway).

### D6 - Large-file guard is plugin-owned and conservative

The plugin refuses to create a Monaco model above 5 MiB of declared file size
and above `limits.maxRequestBytes`, shows a clear in-surface message, reports
clean and sends no read. The shell's 16 MiB read limit remains the hard boundary;
the lower plugin limit protects the hidden frame's heap. File size is metadata
from `shell/init`, so the guard does not read the file to decide.

Alternatives: rely only on Monaco's model limit (late, unpredictable memory
use); raise the shell text limit (a shell change unrelated to plugins).

### D7 - Child-path deploy after the shell checks

`npm run build` still builds only the shell. CI then builds the code plugin with
`EXO_CODE_PLUGIN_BASE_PATH=/exo-editor/code-plugin/`, runs the no-Monaco guard
against the shell dist, and copies `apps/code-plugin/dist` into
`apps/shell/dist/code-plugin` after the bundle budget, CSP and custom-element
checks. The deployed manifest is
`https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json`.

A same-origin plugin therefore gets `sandbox="allow-scripts"` and no storage; the
plugin uses no storage APIs. The same build can be served from
`http://localhost:5176/` for the cross-origin check, where the shell frames it
with `allow-same-origin` and the plugin can use storage. The dev server remains a
development aid; deployed behavior is verified against the Pages URL.

Alternatives: put Monaco in the shell budget (conflates shell size with the
plugin); a second Pages site (needs another repository/account and is not
required); a separate origin by default (loses the first-party child-path
simplicity and is optional per D5).

### D8 - Example workspace and verification are artifacts

`examples/code-plugin-workspace/` contains the deployed-manifest `exo.json` and
small `.ts`, `.json` and `.md` files. The plugin README documents the dev URL,
the deployed URL, the same-origin no-storage rule, the 5 MiB guard and the manual
checks. The deployed verification drives the real Pages shell with an OPFS folder
workspace, approves consent, opens each language, edits and saves, reloads,
disables the plugin and repeats with a cross-origin localhost build.

The no-Monaco guard scans the shell's built JS/CSS for Monaco markers and fails
CI. It runs before the copy, so the plugin assets cannot satisfy or mask it.

## Risks / Trade-offs

- **Monaco workers fail in an opaque-origin frame** → inline workers are used and
  the same-origin deployed check must edit a TypeScript file before the layer is
  considered done; a failure leaves the tasks open rather than hiding it.
- **Monaco touches storage in the opaque origin** → the plugin uses no storage
  APIs and the deployed check inspects `localStorage`/IndexedDB access; a failure
  is fixed in the plugin, not by granting `allow-same-origin`.
- **A visible plugin can imitate shell chrome inside its rectangle** → shell
  chrome stays outside the measured slot, the consent prompt discloses frame
  rendering, and the frame still cannot read or style shell DOM.
- **Bounds drift on resize or layout changes** → the pool observes the slot and
  the window; a missed frame only affects placement, not the session or content.
- **The iframe overlay captures pointer events over the document area** → only
  the active visible frame is shown; hidden frames and disposed frames are
  `display: none`, and shell dialogs/palette use their own higher layers.
- **The plugin cannot initiate a save from inside the iframe** → the shell Save
  action remains authoritative; documented as a v1 limitation instead of adding
  a message outside the contract.
- **A 5 MiB Monaco model is still large** → the plugin refuses earlier than the
  shell's 16 MiB cap and reports a clear message; the budget is plugin-only.
- **Existing consent records change** → the fingerprint includes rendering only
  for `"frame"` entries, so existing hidden manifests keep their records; a
  manifest switching to `"frame"` deliberately re-prompts.

## Migration Plan

- Existing manifests and consents are unchanged; a missing `rendering` behaves as
  `"hidden"`.
- The shell deploy gains `/code-plugin/` as a static child path. It is inert
  until a workspace's `exo.json` references the deployed manifest.
- Rollback removes the plugin package, copy step and guard; the shell surface
  field can remain backward-compatible or be reverted with the change. Existing
  workspaces that reference the plugin lose the editor and fall back to the text
  surface.
- No stored data, workspace file or protocol version is migrated. Verify and
  record the deployed same-origin and cross-origin evidence before archiving.

## Open Questions

None. The visible-surface opt-in, deployment location, Monaco packaging and
verification scope are decided above and reflected in the specs and tasks.
