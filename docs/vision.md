# Exo Editor - Vision

Status: draft. Behavioural details live in [`docs/contracts/`](./contracts/) and are
ratified by the OpenSpec change `define-core-contracts`.

## Problem

A VS Code-style workbench is a large amount of undifferentiated UI: tabs, an
explorer, a bottom panel, a status bar, a command palette, persisted layout and
keyboard-first navigation. Teams that want that shell in the browser either embed
an editor widget and rebuild the chrome around it, or fork an IDE and inherit
everything it assumes.

Both options conflate two different things: the **shell** and the **editors**.

## Thesis

**The shell is the product. Editors are plugins.**

The shell owns the window: layout, tabs, explorer, panels, commands, settings,
workspace access, consent and lifecycle. Anything that renders file content is a
plugin, loaded at runtime from a different origin, with no privileged access to
the shell or to the user's disk.

A plugin is not a module import. It is an untrusted web page in an iframe that
talks to the shell over a versioned `postMessage` protocol. That constraint is
what makes third-party editors safe to load and what keeps the shell's surface
small enough to remain a product of its own.

## What ships

1. **Shell** - a static, frontend-only React 19 + TypeScript application
   deployed to GitHub Pages. Tabs, explorer, panel, status bar and command
   palette come from the reused workbench kit; workspace access, the plugin
   host, consent, settings and the event bus are Exo's own.
2. **Workspace access** - open a folder from the user's machine and read, write,
   create, rename and delete within it. Access is owned by the shell and exposed
   through an extensible provider interface so later backends (in-memory, OPFS,
   remote) do not change the shell or the plugin protocol.
3. **Plugin system** - `exo.json` in the workspace root declares plugin manifest
   URLs. Manifests are cross-origin, consent is explicit, registrations are
   collected in a throwaway iframe, and file handlers run in per-tab iframes.
4. **Plugin SDK and template** - a typed messaging library and a starter
   repository so a plugin author does not hand-roll the protocol.
5. **Reference code plugin** - a Monaco-based editor, built with the template,
   deployed separately, and treated exactly like any other third-party plugin.
6. **Specifications and a layered roadmap** - the contracts that are cheaper to
   change on paper than in code.

## Principles

- **Contracts before code.** The workspace API, manifest, plugin protocol and
  topic API are normative before any implementation consumes them. A contract
  change is an OpenSpec change, not a refactor.
- **Untrusted by default.** No plugin gets a directory handle, a shell DOM node,
  a cookie or a synchronous callback. Everything crosses a validated, versioned
  message boundary. Consent is per origin and per capability surface.
- **The workspace is the isolation boundary.** Loading a different workspace
  tears down every plugin registration, handler session, watcher and
  workspace-scoped setting. Stale plugin state must not survive a switch.
- **Static hosting, zero backend.** No server, no proxy, no accounts, no
  secrets. CORS and the File System Access API are the only transport concerns.
- **Reuse, do not fork.** [`vscode-workbench`](https://github.com/mode777/vscode-workbench)
  supplies the workbench chrome. Exo composes it through props and supplies its
  own explorer, document renderer and commands. Exo does not copy its demo layer
  and does not maintain a divergent copy of the shell.
- **Small surface.** Version 1 has no language server, terminal, Git client,
  collaboration, sync or cloud storage.

## Who it is for

- **Plugin authors** who want to ship an editor - a diagram tool, a notebook, a
  domain-specific language, a binary inspector - without building a workbench.
- **Teams** that want a browser workbench over a local folder, with a curated set
  of editors they trust, and the ability to add one without redeploying the
  shell.
- **The maintainer** as a proving ground for the workbench kit's composition
  model: if the shell can host untrusted editors, the kit's boundaries are real.

## What "done" looks like for v1

1. Open a local folder in Chromium, browse it in the explorer, open a text file,
   edit and save it, with unsaved-change protection.
2. Add a plugin by manifest URL; the consent dialog names the exact origin and
   the requested capabilities; consent survives reload and is re-requested when
   the capability surface widens.
3. A plugin built from the template registers a glob pattern and edits and saves
   a matching file without the shell knowing what the editor is.
4. The Monaco plugin runs against the deployed shell with no shell-side changes.
5. Switching workspaces leaves no plugin session, registration, watcher or
   setting behind.
6. Pushing to `main` deploys the shell and the code plugin, with no server and no
   manual release step.
7. Every contract has a corresponding requirement in `openspec/specs/` and the
   roadmap's layers have been delivered or deliberately dropped.

## Non-goals

- A language server protocol client, completion, diagnostics or refactoring.
- A Git client, terminal, task runner or debugger.
- Multi-user editing, presence, sharing or sync.
- A plugin marketplace, ratings or automatic updates.
- A backend service of any kind, including telemetry.
- Full parity with VS Code: the layout language is borrowed, the product is not
  a VS Code clone and must not adopt its branding.
- Firefox and Safari support in v1 (the folder-backed provider depends on the
  File System Access API; other browsers get an explicit unsupported state until
  another provider exists).
