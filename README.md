# Exo Editor

A frontend-only, serverless editor shell for the web. The shell is the product;
editors are untrusted, sandboxed plugins loaded at runtime from their own
manifest origin. First-party plugins may live on the shell's origin and run with
a stricter sandbox.

Exo gives you a VS Code-style workbench - tabs, explorer, panel, status bar,
command palette - over a folder on your own disk. Anything that renders file
content is a plugin: a cross-origin iframe talking to the shell over a versioned
`postMessage` protocol. Nothing runs on a server.

## Status

Layers 0-10 are complete and archived: the contracts are ratified OpenSpec
specs, the shell is deployed at `https://mode777.github.io/exo-editor/` through
the GitHub Pages workflow, and the workspace, plugin-host, file-editor, event,
settings, SDK/template, Monaco reference-plugin and release-readiness layers are
verified against it. Layer 10 (`release-readiness`, archived as
`2026-11-16-release-readiness`) adds the security review, accessibility pass,
browser matrix, performance budgets, plugin author guide, demo workspace,
walkthrough and release plan; its deployed verification is recorded in
[`ROADMAP.md`](./ROADMAP.md). A post-layer-9 change
(`plugin-initiated-save`, archived as `2026-11-16-plugin-initiated-save`) adds
the id-less `plugin/request-save` intent and Ctrl/Cmd+S in the reference editor,
still additive within protocol major `1`. The parallel Stratofold provider track
(P1-P3) is archived and verified; it does not gate the numbered layers.
Verification is always against the deployed URL, never a local dev server.

Post-release updates are additive within protocol major `1`: the workspace file
picker and directory listing (SDK `1.2.0`/`1.3.0`), plugin-local events
(`1.4.0`), plugin panels, content views and navigation intents (`1.5.0`, shell
`0.3.0`), plugin commands in shell-owned surfaces (`1.6.0`, shell `0.4.0`),
plugin new-file creation with manifest templates (`1.7.0`, shell `0.5.0`), the
optional plugin styling helper and token sheet (`1.8.0`, shell `0.7.0`), and
command-scoped user activation for the picker and Save As dialog (shell `0.8.0`,
SDK unchanged). Shell `0.8.1` is a bug fix that keeps sash drags with the shell
when the pointer crosses a visible plugin frame; `0.8.2` fixes switching
between content-view tabs so the newly active instance's frame is shown; and
`0.8.3` keeps a content-view companion visible only while its tab is active;
`0.9.0` exposes the active content-view instance in `shell/init` and through the
targeted `view/active` event (SDK `1.9.0`); `0.10.0` adds editor-bound panels,
the bottom panel location and the targeted `editor/active` event (SDK `1.10.0`);
`0.11.0` adds surface companion panels for file editors and content views in
primary, secondary and bottom regions (SDK unchanged).
Panels mount lazily and content views open as read-only tabs; both are
user-invoked and excluded from the consent fingerprint.

## How it fits together

- **Shell** - React 19 + TypeScript, static hosting, no backend. Composes the
  [`vscode-workbench`](https://github.com/mode777/vscode-workbench) chrome and
  supplies its own explorer, document area and commands.
- **Workspace** - the shell opens a folder through the File System Access API
  behind a provider interface, so other backends can be added without touching
  the plugin protocol.
- **Plugins** - declared in `exo.json` at the workspace root as manifest URLs.
  The user consents to the exact origin before any code loads. A manifest declares
  file editors as a glob plus a relative editor page; matching files get a
  per-tab handler iframe.
- **SDK and template** - `packages/plugin-sdk` is a typed client for the
  handshake, registration, file-handler and event flows; `packages/plugin-template`
  is a starter plugin built only on it. The template dev server runs at
  `http://localhost:5175/` (`npm run dev:template`), and its build ships at
  `https://mode777.github.io/exo-editor/plugin-template/`.
- **Reference code plugin** - `apps/code-plugin` is a Monaco editor built only on
  the SDK and deployed at
  `https://mode777.github.io/exo-editor/code-plugin/`. Its manifest opts into
  `rendering: "frame"`, so the shell displays the sandboxed handler in the
  document area while the tab, breadcrumbs and Save action stay shell-owned. The shell
  bundle contains no Monaco. The dev server runs at `http://localhost:5176/`
  (`npm run dev:code`), and `examples/code-plugin-workspace/` is a ready workspace.
- **Guide and demo** - [`docs/guide/`](./docs/guide/README.md) is the author
  handoff, and [`examples/demo-workspace/`](./examples/demo-workspace/README.md)
  declares both deployed plugins so the release walkthrough can exercise the
  code plugin, the template plugin and the shell text surface in one folder.

## Documents

| Document                                                      | Contents                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Vision](./docs/vision.md)                                    | Product intent, principles, scope, non-goals                                                                                                                                                                           |
| [Architecture](./docs/architecture.md)                        | Runtime model, lifecycles, trust boundaries, decisions                                                                                                                                                                 |
| [Security review](./docs/security-review.md)                  | Trust-boundary controls, mutation evidence, findings                                                                                                                                                                   |
| [Workspace contract](./docs/contracts/workspace-api.md)       | Provider interface, paths, errors, isolation                                                                                                                                                                           |
| [Manifest contract](./docs/contracts/plugin-manifest.md)      | `exo.json`, `exo-manifest.json`, consent, fingerprint                                                                                                                                                                  |
| [Protocol contract](./docs/contracts/plugin-protocol.md)      | Envelope, handshake, registration, handler sessions                                                                                                                                                                    |
| [Events contract](./docs/contracts/events.md)                 | Topics, ordering, limits                                                                                                                                                                                               |
| [Plugin SDK contract](./docs/contracts/plugin-sdk.md)         | Typed client, origin rules, compatibility policy, template                                                                                                                                                             |
| [Plugin styling contract](./docs/contracts/plugin-styling.md) | Theme helper, token sheet and the three palettes                                                                                                                                                                       |
| [Manifest schema](./schema/exo.schema.json)                   | Shared JSON Schema for `exo.json` and `exo-manifest.json`                                                                                                                                                              |
| [Plugin author guide](./docs/guide/README.md)                 | Quickstart, manifest, protocol, SDK, styling, hosting, consent, testing                                                                                                                                                |
| [Agent skill](./.agents/skills/create-exo-plugin/SKILL.md)    | Single-file skill for assistants building an Exo plugin and hosting it on GitHub Pages; installable by [raw link](https://raw.githubusercontent.com/mode777/exo-editor/main/.agents/skills/create-exo-plugin/SKILL.md) |
| [Demo workspace](./examples/demo-workspace/README.md)         | Shipped code and template plugins in one workspace                                                                                                                                                                     |
| [Walkthrough](./docs/walkthrough.md)                          | Recorded acceptance path with screenshots                                                                                                                                                                              |
| [Accessibility](./docs/accessibility.md)                      | Scope, automated checks, manual script, upstream exceptions                                                                                                                                                            |
| [Browser support](./docs/browser-support.md)                  | Supported, unsupported and unverified combinations                                                                                                                                                                     |
| [Performance](./docs/performance.md)                          | Runtime budgets, reference environment, measurements                                                                                                                                                                   |
| [Security review](./docs/security-review.md)                  | Trust-boundary controls, mutation evidence, findings                                                                                                                                                                   |
| [Releases](./docs/releases.md)                                | Version axes, release checklist, deprecation and breaking changes                                                                                                                                                      |
| [Changelog](./CHANGELOG.md)                                   | Release history                                                                                                                                                                                                        |
| [Stratofold provider](./docs/providers/stratofold.md)         | Remote-provider track, upstream status, npm blocker                                                                                                                                                                    |
| [Roadmap](./ROADMAP.md)                                       | Layered OpenSpec changes and exit criteria                                                                                                                                                                             |
| [Agent guide](./AGENTS.md)                                    | Instructions for coding agents working here                                                                                                                                                                            |

## Contracts are normative

The documents in `docs/contracts/` are ratified by the OpenSpec change
`define-core-contracts` and mirrored as requirements in `openspec/specs/`. They
are the source of truth; [`schema/exo.schema.json`](./schema/exo.schema.json) is
the shared shape for both JSON files. A behaviour change is a contract change,
not an implementation detail.

```bash
openspec list
openspec validate --all
```

## License

Not yet chosen.
