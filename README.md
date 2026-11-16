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

Layers 0-8 are complete and archived: the contracts are ratified OpenSpec
specs, the shell is deployed at `https://mode777.github.io/exo-editor/` through
the GitHub Pages workflow, and the workspace, plugin-host, file-editor, event,
settings and SDK/template layers are verified against it. Layer 9
(`monaco-code-plugin`) adds the Monaco reference plugin, the opt-in visible
handler surface and its child-path deployment. The parallel Stratofold provider
track (P1) is documented and blocked on its client's npm publication; it does not
gate the numbered layers. Verification is always against the deployed URL, never
a local dev server.

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
  document area while the tab, header and Save action stay shell-owned. The shell
  bundle contains no Monaco. The dev server runs at `http://localhost:5176/`
  (`npm run dev:code`), and `examples/code-plugin-workspace/` is a ready workspace.

## Documents

| Document | Contents |
| --- | --- |
| [Vision](./docs/vision.md) | Product intent, principles, scope, non-goals |
| [Architecture](./docs/architecture.md) | Runtime model, lifecycles, trust boundaries, decisions |
| [Workspace contract](./docs/contracts/workspace-api.md) | Provider interface, paths, errors, isolation |
| [Manifest contract](./docs/contracts/plugin-manifest.md) | `exo.json`, `exo-manifest.json`, consent, fingerprint |
| [Protocol contract](./docs/contracts/plugin-protocol.md) | Envelope, handshake, registration, handler sessions |
| [Events contract](./docs/contracts/events.md) | Topics, ordering, limits |
| [Plugin SDK contract](./docs/contracts/plugin-sdk.md) | Typed client, origin rules, compatibility policy, template |
| [Manifest schema](./schema/exo.schema.json) | Shared JSON Schema for `exo.json` and `exo-manifest.json` |
| [Stratofold provider](./docs/providers/stratofold.md) | Remote-provider track, upstream status, npm blocker |
| [Roadmap](./ROADMAP.md) | Layered OpenSpec changes and exit criteria |
| [Agent guide](./AGENTS.md) | Instructions for coding agents working here |

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
