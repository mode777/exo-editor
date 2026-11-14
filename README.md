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

Layer 0 and layer 1 are complete: the five contracts are ratified OpenSpec specs
and the shell is deployed at `https://mode777.github.io/exo-editor/` through the
GitHub Pages workflow. Layer 2 (workspace provider) is next in the
[roadmap](./ROADMAP.md).

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
- **SDK and reference plugin** - a typed messaging library, a starter template,
  and a Monaco-based code editor deployed separately as the proof that the shell
  has no privileged editor.

## Documents

| Document | Contents |
| --- | --- |
| [Vision](./docs/vision.md) | Product intent, principles, scope, non-goals |
| [Architecture](./docs/architecture.md) | Runtime model, lifecycles, trust boundaries, decisions |
| [Workspace contract](./docs/contracts/workspace-api.md) | Provider interface, paths, errors, isolation |
| [Manifest contract](./docs/contracts/plugin-manifest.md) | `exo.json`, `exo-manifest.json`, consent, fingerprint |
| [Protocol contract](./docs/contracts/plugin-protocol.md) | Envelope, handshake, registration, handler sessions |
| [Events contract](./docs/contracts/events.md) | Topics, ordering, limits |
| [Manifest schema](./schema/exo.schema.json) | Shared JSON Schema for `exo.json` and `exo-manifest.json` |
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
