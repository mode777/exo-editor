# Design

## Context

Exo is a shell plus untrusted editors. The reused workbench kit already solves the
chrome: layout, tabs, panels, status bar, command palette, persisted session.
Verified against `vscode-workbench@0.1.3`, its preset accepts `views`,
`renderDocument`, `commands`, `menus`, `quickOpen`, `fileIcons`, `statusBar`,
`initialSession` and `onRevealFile` as props, and its file tree and documents are
deliberate mocks. That leaves Exo to own three things: workspace access, the
plugin host and the protocol between them.

Those three are contracts, not features. This change settles them before code.

## Goals

- One mediated path to files, with an interface other providers can implement.
- One way to load editor code, safe enough that a plugin is untrusted even after
  consent.
- One message channel and one event channel, both versioned.
- Contracts that can be implemented and tested without the shell existing.

## Non-Goals

- A plugin marketplace, signing or automatic updates.
- LSP, terminal, Git or collaboration.
- Firefox/Safari folder support in v1.
- Any server component.

## Decisions

### D1 - Compose the workbench kit instead of forking it

The upstream preset is prop-driven at exactly the seams Exo needs. Forking would
buy a few weeks and cost every upstream fix, every accessibility patch and the
kit's boundary work. Exo therefore depends on the published package, supplies its
own explorer/document/commands, and never imports the upstream demo layer.

Alternative rejected: copy `apps/template` and modify it. It would make the mock
file tree look like a starting point and hide the real work (workspace access,
plugin host) inside a fork.

### D2 - The shell owns workspace access

A plugin must never see a `FileSystemHandle`. Handing one out would make consent,
path containment and workspace reset unenforceable, because a handle is a
capability the shell cannot revoke or scope per message. The provider interface
also gives a clean place to add backends without touching the protocol.

Alternative rejected: let plugins call the File System Access API directly after
the user grants a directory. It breaks the single consent model and cannot be
undone on workspace switch.

### D3 - Plugin pages are same-origin with their manifest, and may share the shell origin

Same-origin with the manifest gives consent a single origin to name and makes
directory containment meaningful. Serving a first-party plugin from the shell
origin is allowed because it is operationally much simpler, but it changes the
sandbox: `allow-same-origin` must be dropped, so the plugin runs in an opaque
origin with no storage, cookies or parent DOM. A cross-origin plugin keeps
`allow-same-origin` and its own storage.

Alternative rejected: reject same-origin plugins entirely. It forces every
first-party plugin onto a second host for no security gain once the sandbox is
chosen by origin rather than assumed.

### D4 - Consent is a fingerprint, not a version

Users consent to what a plugin can do, not to a string. Hashing id, entry origin,
permissions and editor globs means a cosmetic release does not re-prompt and a
capability expansion always does. Storing it machine-wide matches the user's
mental model ("I trust this editor") and keeps the prompt from following them
between folders.

Alternative rejected: prompt per version. It trains users to click through
updates and gives no signal when permissions actually widen.

### D5 - First-party plugins may share the shell's GitHub Pages origin (decided)

GitHub Pages project sites for one account share `<owner>.github.io`, so a child
path such as `/exo-editor/code-plugin/` is same-origin with the shell. That is
accepted: the plugin is mounted without `allow-same-origin`, and consent states
that it has no storage access. Cross-origin hosting remains available for
third-party plugins and for any plugin that needs storage, but it is no longer a
blocker. The cost is explicit: same-origin plugins cannot use `localStorage`,
IndexedDB, cookies or service workers.

### D6 - Persist the directory handle in IndexedDB

`FileSystemDirectoryHandle` is structured-cloneable but not JSON-serializable.
`localStorage` will stringify it to `{}`. IndexedDB is the only browser storage
that can hold it. Permissions are not preserved across reloads, so the shell
re-queries and, when needed, re-requests in a user gesture, restoring read-only
until then.

### D7 - Workspace switch resets workspace-scoped state only

Resetting layout and theme on every folder change would be hostile and is not
what "reset customization" is protecting against. The risk is plugin-derived
state leaking across workspaces. Tabs, registrations, handler sessions,
watchers, caches and plugin settings are workspace-scoped; global layout and
theme are not. The reset order is normative in the workspace contract.

### D8 - `exo.json` is rewritten canonically

Preserving formatting and comments in JSON requires a CST parser and a policy for
where comments go when a plugin is removed. The settings UI is the primary
editor, so the shell rewrites 2-space JSON and the UI states that formatting and
comments are not preserved. Plugins never write the file at all.

Alternative rejected: JSONC. It would preserve comments but diverge from the
declared `exo.json` contract and still need a CST for minimal diffs.

### D9 - Sandbox attributes are chosen by origin, and are not the only defense

Cross-origin: `allow-scripts allow-same-origin`. Same-origin: `allow-scripts`
only, never `allow-same-origin`, because that pair would let the frame remove its
own sandbox. Neither case allows top navigation, popups, modals or downloads. The
host does not rely on the sandbox: it validates origin and source on every
message, caps payloads, correlates request ids and ignores unknown types. The
sandbox limits what a compromised plugin can do to the user's other tabs; the
protocol limits what it can do to the workspace.

### D10 - Chromium-first

The folder provider needs the File System Access API. A cross-browser fallback
would either be a different product (upload/download) or a large storage layer
(OPFS with import/export). v1 ships one provider, one explicit unsupported state
and a provider interface that makes the next one additive.

### D11 - Plugin settings live in the shell, not in `exo.json`

`exo.json` declares plugins; it is not a settings file. Writing plugin settings
into a file the user owns and the shell rewrites canonically would create noisy
diffs and couple settings to plugin declaration. Settings are stored by the shell
per workspace and delivered through init and `config/changed`.

### D12 - Keep the SDK, template and reference plugin in-repository through v1 (decided)

One repository makes the protocol change and its consumers change together while
the contract is young. Splitting early would add release coordination before the
protocol has proven stable. The SDK, template and Monaco plugin therefore ship as
workspace packages in this repository for v1. A split is reconsidered after
layer 9, once the protocol has a real consumer; it does not block layer 8.

### D13 - Protocol major is separate from manifest schema and shell version

Plugins and the shell deploy independently. A single version number would force
unnecessary re-consent and make "the plugin is too new for this shell" and "the
plugin speaks a different wire protocol" indistinguishable.

### D14 - Consent covers a page root, not individual pages

The vision calls for plugins to register globs and relative editor pages. Binding
consent to individual page URLs would re-prompt on every page rename and still
not describe what the plugin can load. Exo instead anchors consent to the
directory of the controller entry: siblings and descendants are inside the
approved root, parents and unrelated directories are rejected. The manifest
declares its initial globs and editor pages for the prompt, the registration phase
activates globs, and later pages inside the root load without a new prompt. The
fingerprint includes the root, not page paths.

Alternative rejected: require re-consent for every new page. It trains users to
approve without reading, and a page rename is not a capability change.

Alternative rejected: let registration add arbitrary globs. The user saw a specific
glob list in the prompt; adding to it silently would make that display a lie.

## Validation Strategy

The contracts must be testable before the shell exists:

- **Provider conformance suite.** One suite runs against the memory provider and
  the folder provider: normalization, containment, reserved paths, `ifVersion`
  conflicts, abort, teardown.
- **Manifest fixtures.** Valid, each invalid field, cross-origin entry, escaping
  entry, missing CORS, oversized body, redirect to another origin.
- **Protocol fixtures.** A stub plugin built from the contract exercises
  handshake, registration, handler init, read, save, conflict, timeout, oversized
  payload, wrong origin and dispose.
- **Consent fixtures.** Fingerprint stability for cosmetic changes and change for
  permissions/globs; store corruption; revoke.
- **Event fixtures.** Ordering, coalescing, overflow, unsubscribe and
  dispose-while-streaming.

Each security control gets a negative test that fails when the control is
removed.

## Risks

| Risk | Mitigation |
| --- | --- |
| Protocol churn after the SDK ships | SDK and reference plugin stay in-repo until layer 9 (D12) |
| Consent fatigue makes users click through | Fingerprint excludes display metadata; only capability changes re-prompt |
| FSA permission loss confuses users | Explicit read-only restore state and a "Restore access" action, not a silent failure |
| Large files over `postMessage` | Read-on-demand, 16 MiB cap, explicit `too-large` error |
| Upstream `0.x` breakage | Pin the minor; re-verify the prop surface on upgrade; compose only through public exports |
| Same-origin plugin escapes the sandbox or reaches shell storage | Never emit `allow-same-origin` for a same-origin frame; test that the iframe has an opaque origin and cannot read `localStorage` |
| Plugin root too broad (whole site for a first-party plugin) | Deploy first-party plugins under a dedicated child directory such as `/exo-editor/code-plugin/`, never at the site root |

## Migration

None. No implementation or consumer exists. Once archived, this change creates
`openspec/specs/{editor-shell,workspace-access,plugin-manifest,plugin-protocol,plugin-events}/spec.md`.
Later changes modify those specs rather than adding a parallel contract.

## Open Questions

None. Ratification closed D12 (in-repository through v1), confirmed D7 (global
layout and theme survive a workspace switch), and settled the event questions in
[`docs/contracts/events.md`](../../../docs/contracts/events.md#8-resolved-during-ratification):
file-change events carry no originating session, `theme/changed` carries a theme
name rather than resolved tokens, and v1 has no background subscriptions.
