# Proposal

## Why

Layers 0-8 prove the shell, the plugin host, file handling, events, settings and
the typed SDK, but every deployed consumer is a fixture or a starter that edits
files by convention rather than by showing an editor. The roadmap's final
numbered layer is the proof the architecture was built for: a real Monaco editor,
built with the SDK, deployed like any third-party plugin, with no Monaco code and
no privileged path in the shell.

Implementing it exposes one gap in the ratified presentation contract: handler
frames are required to stay hidden, so a plugin can own a document's content but
cannot show an interactive editor. Layer 9 closes that gap in the generic
protocol rather than granting the reference plugin an exception. Handler frames
gain an opt-in frame surface declared in the manifest; registration frames stay
hidden, and the shell still owns the tab, header and Save action.

## What Changes

- Add `apps/code-plugin` (`@exo/code-plugin`), a Monaco-based reference code
  editor built only on `@exo/plugin-sdk`. It registers `.ts`, `.tsx`, `.js`,
  `.jsx`, `.json` and `.md` files, configures Monaco's built-in language support
  (no language server, completion service or diagnostics), and owns its visible
  editor surface, dirty state, save reply, external-change handling, large-file
  guard and `theme/changed` sync.
- Add `rendering: "hidden" | "frame"` to `contributes.fileEditors`, defaulting to
  `"hidden"`. A `"frame"` contribution mounts its handler iframe visibly in the
  document area for the active tab; a `"hidden"` contribution keeps the existing
  headless behavior. The value is manifest metadata, not a new protocol message,
  and it is part of the consent fingerprint because it changes what the plugin
  can display.
- Teach the shell to place a visible handler frame in a measured document-area
  slot without reparenting the iframe, to hide it when another tab is active, and
  to keep the tab, header, save control and notices outside the plugin frame. No
  Monaco, editor-specific branch or privileged plugin path enters the shell.
- Build the plugin as a static child path of the shell site
  (`/exo-editor/code-plugin/`) after the shell budget checks, with its own Vite
  base path, dev server on port 5176 and a copy script. A cross-origin deploy
  remains possible; the same build is served on `localhost` for the cross-origin
  sandbox check.
- Add an example workspace whose `exo.json` points at the deployed manifest, plus
  manual test steps, a plugin README and a shell bundle guard that fails if
  Monaco code appears in the shell artifact.
- Update the manifest, protocol and file-editor contracts and their OpenSpec
  specs for the frame surface, then record the deployed verification, commands
  and layer status in `ROADMAP.md`, `AGENTS.md` and `README.md`.

**Explicit non-goals:** language servers, LSP, completion or diagnostics beyond
Monaco's built-in text model, a second shell-owned editor surface, Monaco in the
shell bundle, plugin storage for same-origin first-party deployments, a
plugin-initiated save message, a new protocol version, a separate deploy target
by default, and any change to file access, consent or sandbox rules.

## Capabilities

### New Capabilities

- `reference-code-plugin`: the Monaco-based reference editor - its manifest and
  language scope, SDK-only protocol use, visible surface behavior, dirty, save,
  external-change and theme handling, large-file guard, child-path deployment,
  example workspace and the proof that the shell contains no Monaco code.

### Modified Capabilities

- `plugin-manifest`: adds the optional `fileEditors[].rendering` field, its
  validation and default, and includes frame rendering in the consent
  fingerprint.
- `plugin-protocol`: scopes the hidden-frame rule to registration frames and
  hidden handler frames, and defines the opt-in visible handler frame while
  keeping the same sandbox, origin and message rules.
- `plugin-file-editors`: adds the visible handler surface requirement - display
  in the document area for the active document, shell chrome outside the frame,
  hide without disposal on tab switch, and no shell DOM access.

## Impact

- `apps/code-plugin/` (new): package manifest, Vite configuration, controller and
  editor pages, Monaco integration and worker setup, manifest, styles, README,
  tests and source scans.
- `apps/shell/src/plugins/`: `manifest.ts`, `registry.ts`, `handler.ts`,
  `handlers.ts`, `frame.ts`, `consent.ts`, `DocumentStore`/`DocumentArea` wiring
  and their tests; a generic frame-surface path, not a Monaco path.
- `schema/exo.schema.json`: `fileEditors[].rendering` and the default.
- `apps/shell/scripts/copy-code-plugin.mjs` and
  `apps/shell/scripts/check-dist-no-monaco.mjs` (new); root scripts
  `dev:code`, `build:code`, `deploy:copy-code` and `check:dist-no-monaco`.
- `.github/workflows/ci.yml`: build and copy steps after the shell budget, plus
  the no-Monaco guard.
- `examples/code-plugin-workspace/` (new) and `apps/code-plugin/README.md`.
- `docs/contracts/plugin-manifest.md`, `plugin-protocol.md`,
  `plugin-file-editors` documentation, `docs/architecture.md`, `README.md`,
  `AGENTS.md`, `ROADMAP.md` and the matching OpenSpec deltas.
- New runtime dependency in the plugin workspace only: `monaco-editor`. No shell
  dependency, no backend, no secret and no protocol version change.
