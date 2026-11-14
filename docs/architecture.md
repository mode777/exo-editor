# Exo Editor - Architecture

Status: draft. Contracts referenced here are in [`docs/contracts/`](./contracts/).
Verified facts about the reused kit are marked with the version they were checked
against.

## 1. Shape of the system

Everything runs in one browser tab. There is no server component.

```text
┌────────────────────────────── browser tab ───────────────────────────────┐
│                                                                          │
│  shell origin (static site)                                              │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Exo shell (React 19 + TypeScript)                                  │  │
│  │                                                                    │  │
│  │  workbench chrome          Exo-owned core                          │  │
│  │  (vscode-workbench)        ┌──────────────────────────┐            │  │
│  │  title bar, activity bar,  │ workspace session        │            │  │
│  │  explorer host, tabs,      │ plugin registry          │            │  │
│  │  panel, status bar,        │ consent store            │            │  │
│  │  command palette, layout   │ event bus                │            │  │
│  │                            │ settings store           │            │  │
│  │                            └────────────┬─────────────┘            │  │
│  └─────────────────────────────────────────┼──────────────────────────┘  │
│                                            │ mediated file access        │
│                                   ┌────────▼─────────┐                    │
│                                   │ workspace        │                    │
│                                   │ provider         │                    │
│                                   └────────┬─────────┘                    │
│                                            │ File System Access API      │
└────────────────────────────────────────────┼─────────────────────────────┘
                                             │
                                    ┌────────▼─────────┐
                                    │ user's folder    │  exo.json at root
                                    └──────────────────┘

  plugin origins (cross-origin iframes)
  ┌──────────────────────┐   postMessage    ┌──────────────────────┐
  │ registration frame   │ ◄──────────────► │ shell                │
  │ (hidden, short-lived)│                  │                      │
  └──────────────────────┘                  │                      │
  ┌──────────────────────┐   postMessage    │                      │
  │ file handler frame   │ ◄──────────────► │                      │
  │ (hidden, per tab)    │                  │                      │
  └──────────────────────┘                  └──────────────────────┘
```

The plugin iframes are hidden. They render into nothing; the shell owns the
visible surface and the tab. A plugin is a headless controller that produces
content on request. This is deliberate: it removes DOM and CSS coupling, makes
the protocol the only contract, and lets the same plugin serve a tab and a
preview.

## 2. Ownership

| Concern | Owner | Notes |
| --- | --- | --- |
| Layout, tabs, panel, status bar, palette | `vscode-workbench` preset | Configured through props; Exo does not patch it |
| Explorer view, document area content, commands, menus | Exo shell | Supplied to the preset as `views`, `renderDocument`, `commands`, `menus`, `quickOpen`, `statusBar`, `initialSession` |
| Filesystem access | Exo workspace session | Providers implement the contract; nothing else touches a directory handle |
| `exo.json` | Exo shell | Read and written only by the shell; plugins are denied the path |
| Plugin manifests, consent | Exo plugin host | Consent is machine-wide, keyed by origin and capability fingerprint |
| Plugin lifecycle | Exo plugin host | Registration frames and handler frames are both short-lived |
| Plugin content, dirty state | Plugin iframe | The shell never parses editor content |
| Themes, file change notifications | Exo event bus | Topics are the only shell-to-plugin push channel |
| Persistence (handle, consent, settings, layout) | Shell | IndexedDB for handles and workspace state, `localStorage` for consent |

## 3. Workspace lifecycle

```text
        ┌────────────┐   pick folder    ┌────────────┐   provider ok   ┌──────────┐
        │ no-workspace│ ───────────────► │  loading   │ ──────────────► │  ready   │
        └────────────┘                  └────────────┘                 └────┬─────┘
              ▲                              │ error                      │ switch
              │                              ▼                            ▼
              │                        ┌────────────┐              ┌────────────┐
              └────────────────────────│   failed   │              │ switching  │
                                       └────────────┘              └─────┬──────┘
                                                                         │ teardown
                                                                         ▼
                                                                   ┌────────────┐
                                                                   │ no-workspace│
                                                                   └────────────┘
```

Teardown order is normative and runs before the next workspace is opened:

1. Dispose every file handler session (close frames, drop pending requests).
2. Dispose every plugin registration and its registry entries.
3. Unsubscribe all event topics and reset per-workspace sequence numbers.
4. Stop watchers and abort in-flight workspace operations.
5. Drop workspace-scoped settings, open tabs and file caches.
6. Persist the new workspace identity and provider state.

Global preferences - theme, region visibility, sash sizes - are not part of the
workspace and survive the switch. This is the working interpretation of "reset
all customization and registrations". It is recorded as decision D7 below and
should be confirmed during ratification.

## 4. Plugin lifecycle

Two frame lifetimes exist, and both start with the same handshake.

**Registration frame** (once per plugin per workspace load, or immediately when a
plugin is added):

```text
shell                                   plugin iframe (cross-origin)
  │  mount hidden iframe (controller entry)        │
  │ ──────────────────────────────────────────────►│
  │                                                │ plugin/ready
  │ ◄──────────────────────────────────────────────│
  │ shell/init (id, protocol, theme, workspace)    │
  │ ──────────────────────────────────────────────►│
  │                                                │ plugin/register (0..n)
  │ ◄──────────────────────────────────────────────│
  │                                                │ plugin/register-complete
  │ ◄──────────────────────────────────────────────│
  │ shell/register-ack                             │
  │ ──────────────────────────────────────────────►│
  │  unload iframe                                 │
```

**File handler frame** (one per open document, only for plugins that registered a
matching glob):

```text
shell                                   plugin iframe (cross-origin)
  │  mount hidden iframe (matched editor entry)    │
  │  handshake as above                            │
  │ shell/init (theme, file metadata, limits)      │
  │ ──────────────────────────────────────────────►│
  │                                                │ plugin/request-file
  │ ◄──────────────────────────────────────────────│
  │ shell/file-content                             │
  │ ──────────────────────────────────────────────►│
  │                                                │ plugin/dirty
  │ ◄──────────────────────────────────────────────│
  │ shell/request-save                             │
  │ ──────────────────────────────────────────────►│
  │                                                │ plugin/save-content
  │ ◄──────────────────────────────────────────────│
  │ shell/save-result                              │
  │ ──────────────────────────────────────────────►│
  │ shell/dispose (tab close or workspace switch)  │
  │ ──────────────────────────────────────────────►│
```

File contents are never pushed proactively. The shell answers read requests and
asks for content only at save time. A handler that never saves never sends the
file back, which keeps large files out of the message channel until needed.

Timeouts are contract values, not implementation details: 10 s to `plugin/ready`,
10 s from `shell/init` to `plugin/register-complete`, 5 s for a save response,
1 s for a dispose acknowledgement. A miss is reported to the user with the
plugin id and the phase that failed, and the frame is removed.

## 5. Trust model

Plugins are untrusted, even though the user consented to them.

- **Origin is the only identity.** The shell validates `event.origin` against the
  manifest origin and `event.source` against the iframe's `contentWindow` on
  every message. Consent is bound to the manifest origin and a fingerprint of the
  declared capabilities, not to a display name.
- **Origin determines the sandbox.** A plugin served from another origin is
  mounted with `sandbox="allow-scripts allow-same-origin"`: it keeps its own
  storage and a cross-origin frame still cannot reach into the parent. A
  first-party plugin served from the shell origin is allowed, but is mounted with
  `sandbox="allow-scripts"` only, so it runs in an opaque origin with no storage,
  no cookies and no access to the parent. Consent is shown in both cases and
  states which applies. See D3, D5 and D9.
- **Opaque origins have no origin to validate.** A same-origin plugin without
  `allow-same-origin` reports `event.origin === "null"`. The host accepts that
  only when `event.source` is the exact iframe and `plugin/ready` echoes the
  frame's session id. Identity is then the frame instance, not an origin, and the
  consent dialog states that the plugin cannot be isolated by origin.
- **Page loading is confined to the plugin's root.** The root is the directory of
  the controller entry (`runtime.entry`). Editor pages and any follow-up documents
  may be siblings or descendants of that root; parent traversal and unrelated
  directories are rejected after normalization. Consent covers the root, not each
  page. See D14.
- **No direct filesystem access.** The shell passes no `FileSystemHandle` to a
  frame. Every path is normalized, confined to the workspace root, and checked
  against the reserved set (`exo.json` and `.exo/`).
- **No DOM access.** Frames are hidden and have no shell markup to read or
  restyle. The shell does not inject plugin HTML into itself.
- **The protocol is the sandbox.** Unknown message types are ignored, malformed
  envelopes are dropped, payloads are size-capped, and request ids are
  correlated so a plugin cannot answer a request it was not given.
- **The shell never evaluates plugin content.** No `eval`, no `new Function`, no
  plugin-supplied HTML outside the iframe, no `dangerouslySetInnerHTML` for
  plugin data.
- **Manifests are data.** A manifest is validated against the schema before any
  UI or frame is created; an invalid manifest is reported, never partially
  applied.

The corresponding CSP for the shell is `frame-src https:`, `connect-src 'self'
https:`, `script-src 'self'`, with no `unsafe-eval`. Plugin origins are expected
to serve `Access-Control-Allow-Origin` for their manifest; a missing CORS header
is a manifest load failure with an actionable message, not a silent skip.

## 6. Hosting topology

```text
GitHub Pages (shell + first-party plugin)      third-party plugin host
https://<owner>.github.io/exo-editor/           https://plugins.example.com/...
https://<owner>.github.io/exo-editor/code/      (any HTTPS origin)
        │                                             │
        └───────────── exo.json references ───────────┘
```

**GitHub Pages origin gotcha:** every project site for one account shares
`https://<owner>.github.io`. A first-party plugin (the code editor) may live
there as a sibling or child path, but it is then same-origin with the shell and
is mounted with `allow-scripts` only. That means no `localStorage`, IndexedDB,
cookies, service workers or parent DOM access inside the plugin. The consent
dialog still appears and states this explicitly. Choose a child path
(`/exo-editor/code-plugin/`) so the plugin root sits under the shell's own Pages
path and no extra deploy target is needed.

Third-party plugins should be cross-origin. Only a cross-origin plugin gets
`allow-same-origin` and therefore its own storage. Hosting the code plugin on a
separate origin remains an option if it ever needs storage or stricter
separation; it is no longer a blocker (D5).

Local development uses two origins by construction: shell on
`http://localhost:5173`, plugin on `http://localhost:5174`. `localhost` is the
only permitted non-HTTPS origin; manifests on other `http://` origins are
rejected.

## 7. Target repository layout

The shell is one application. The SDK, template and reference plugin are
workspace packages in this repository and may be split out later; the decision
is deferred to the SDK layer.

```text
AGENTS.md                agent rules and invariants
ROADMAP.md               layered OpenSpec change plan
apps/
  shell/                 Exo editor shell (the deployable)
  code-plugin/           Monaco reference plugin (separate deploy target)
packages/
  plugin-sdk/            typed postMessage client, shared by plugins
  plugin-template/       starter plugin, published or copied
docs/
  vision.md  architecture.md
  contracts/             normative contracts, one file per surface
openspec/
  specs/                 ratified capabilities
  changes/               active changes
```

Reuse rules:

- `vscode-workbench` is a normal npm dependency (`0.1.x` at time of writing,
  verified against 0.1.3). Its public preset exports are `vscode-workbench`
  (preset), `vscode-workbench/react`, `/core`, `/elements/*` and `/styles/*`.
- The preset receives Exo's explorer view, document renderer, commands, menus,
  quick-open provider, file icons, status bar and initial session through props.
  Exo never imports `apps/template/src/demo` equivalents from the upstream
  repository and never patches the preset's source.
- Upstream's shell is real; its file tree, documents and source-control views are
  deliberate mocks (verified in the upstream README at 0.1.3). Exo therefore
  supplies the explorer and the document area itself. Do not assume upstream
  contains a working filesystem.
- Upstream is `0.x`: minor releases may break. Pin the minor and re-verify the
  composition surface before upgrading.

## 8. Decisions

Decided decisions are normative for implementation. Open decisions block the
layer named in the last column.

| ID | Decision | Status | Blocks |
| --- | --- | --- | --- |
| D1 | Reuse `vscode-workbench` as a dependency and compose it; no fork, no copied demo layer | decided | layer 1 |
| D2 | The shell owns all workspace access through a provider interface; plugins never receive handles | decided | layer 2 |
| D3 | A plugin entry page must be same-origin with its manifest; it may share the shell origin, in which case the stricter sandbox applies | decided | layer 4 |
| D4 | Consent is keyed by manifest origin plus plugin id plus a capability fingerprint, stored machine-wide | decided | layer 4 |
| D5 | First-party plugins may share `<owner>.github.io`; a separate origin is optional and only needed for plugin storage or stricter separation | decided | none |
| D6 | The folder provider persists its directory handle in IndexedDB and re-requests permission after reload | decided | layer 2 |
| D7 | Workspace switch resets tabs, plugin registry and workspace-scoped settings but keeps global layout and theme | decided | layer 2 |
| D8 | `exo.json` is shell-only; the settings UI rewrites it as canonical 2-space JSON and does not preserve comments or formatting | decided | layer 3 |
| D9 | Cross-origin frames use `sandbox="allow-scripts allow-same-origin"`; same-origin frames use `allow-scripts` only; never top navigation, popups or modals | decided | layer 4 |
| D10 | v1 supports Chromium only for folder-backed workspaces; other browsers get an explicit unsupported state | decided | layer 2 |
| D11 | Plugin settings live in the shell's store keyed by workspace, not in `exo.json` | decided | layer 7 |
| D12 | The SDK/template and Monaco plugin stay in this repository at first; split-out is revisited after the reference plugin ships | open | layer 8 |
| D13 | Manifest and protocol are versioned independently; the shell accepts exactly one protocol major version per release | decided | layer 4 |
| D14 | Page loading is confined to the directory tree of the controller entry (siblings and descendants); consent covers that root, not each page | decided | layer 4 |
