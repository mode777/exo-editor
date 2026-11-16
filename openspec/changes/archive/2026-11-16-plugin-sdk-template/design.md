# Design

## Context

See `proposal.md` for motivation and the `plugin-sdk` delta for normative
behavior. The layer builds on code that already exists and must not change it:

- `apps/shell/src/plugins/protocol.ts` owns the envelope, constants, boundary
  selection and violation budget. `registration.ts` and `handler.ts` are the two
  real state machines; `frame.ts` hides the DOM iframe behind `FrameTransport`,
  and `frame-test-support.ts` provides a source/origin-injecting fake.
- `apps/shell/public/plugin-host-fixture/` is a dependency-free, hand-rolled
  protocol implementation. It is the deployed negative/edge-case oracle.
- The shell is the only app. `package.json` already declares
  `workspaces: ["apps/*", "packages/*"]`, so `packages/` exists in the layout but
  no package has been created yet.
- CI (`verify` then `deploy`) builds only `apps/shell`, runs the budget, CSP and
  custom-element checks, uploads `apps/shell/dist` and deploys it to Pages.
- `docs/architecture.md` D12 keeps the SDK, template and reference plugin in this
  repository through v1. Nothing is published.

## Goals / Non-Goals

**Goals:**

- One typed implementation of the plugin side of the protocol, with the same
  origin and identity strictness as the shell and no browser requirement in its
  core.
- A template that proves the SDK is enough to ship a plugin, and conformance
  tests that prove the SDK against the shell's real state machines.
- A deployed template child path so the edit/save exit criterion is demonstrated
  on the deployed shell, not a local dev server.
- A compatibility policy that can be enforced by package metadata, constants and
  tests rather than prose alone.

**Non-Goals:**

- A second protocol implementation in the shell, or any shell runtime dependency
  on the SDK.
- Publishing, versioned CDN hosting, a docs site or a plugin registry.
- Migrating the hand-rolled fixture to the SDK. Keeping an independent
  implementation is deliberate: it catches SDK/shell co-drift.
- Rendering plugin UI into the shell DOM, plugin storage for same-origin
  first-party plugins, or background frames.
- Any wire message, field, limit, sandbox, consent or manifest change.

## Decisions

### D1 - Two packages, source-consumed, private in v1

```text
packages/
  plugin-sdk/        @exo/plugin-sdk, version 1.0.0, private, no runtime deps
    src/index.ts     DOM-free core (constants, types, envelope, gate, clients)
    src/browser.ts   browser adapter: fragment + parent + window listener
    src/*.test.ts    unit tests, Vitest node environment
  plugin-template/   @exo/plugin-template, private
    plugin.html      controller entry
    editor.html      editor entry
    negative/protocol-mismatch.html
    public/exo-manifest.json, public/exo-manifest-mismatch.json
    src/*.ts         controller/editor/mismatch pages, Vite multi-page build
```

The SDK is consumed as TypeScript source through `exports` (`"."` and
`"./browser"`), not a built `dist`. Both consumers are Vite/tsc workspaces in
this repository; a `tsc --noEmit` typecheck is the build check. This avoids a
build-order dependency where the shell tests would need the SDK compiled before
Vitest starts. If the SDK is ever published, that change adds a real build and a
package rename; it is out of scope while D12 holds. `@exo/plugin-sdk` is
`private: true` and version `1.0.0`, so the package major and the protocol major
are visibly the same number.

Alternatives: a single package containing the template (mixes runtime and
fixture, no separate build); a published package (D12 forbids it and no registry
destination exists); emitting `dist` before tests (fragile in CI and local
watch).

### D2 - DOM-free core with an injected transport

The core never reads `window`, `document`, `location` or `parent`. It works on a
small transport seam:

```ts
interface PluginTransport {
  hostOrigin: string
  mode: 'register' | 'editor'
  sessionId: string
  post(message: Envelope): void
  receive(listener: (message: unknown, meta: { origin: string; source: unknown }) => void): () => void
}
```

`src/browser.ts` builds one from `location.hash`, verifies that `exo-host` is an
absolute `http(s)` origin with no path, query or credentials, requires
`exo-mode` to be `register` or `editor` and `exo-session` to be non-empty, listens
on `window`, and posts to `window.parent`. Core unit tests inject a fake
transport and run in Vitest's `node` environment. ESLint bans the four globals in
`src/index.ts` and the core modules, so the rule survives a refactor.

Alternatives: a single browser-only package (tests would need jsdom and the
"no DOM assumptions" promise would be untestable); reading `globalThis` lazily
inside every client (same problem, less obvious).

### D3 - One message gate enforces source, origin and identity

Every incoming message passes one gate before any client sees it:

1. `source` must be the parent window supplied by the transport.
2. `origin` must equal `hostOrigin` exactly. The shell is the sender in both
   sandbox modes, so its origin is nameable even when the plugin frame's own
   origin is opaque. The SDK never accepts `*` or `"null"` as a sender origin.
3. The envelope must be a plain object with `exo: 1`, a non-empty `type`, and
   `id`/`replyTo` strings of at most 64 characters.
4. `shell/init` must additionally carry `protocolVersion`, `mode` and
   `sessionId`; the latter two must echo the transport values.

The gate drops everything else without throwing. A dropped `shell/init` leaves
the handshake pending until its timeout, so a spoofed init cannot resolve it.
Outgoing messages always use `hostOrigin` as the `postMessage` target; the SDK
never posts to `*`. This mirrors `protocol.ts` on the shell side and gives the
plugin the same fail-closed posture.

Alternatives: per-client checks (one missed path becomes a spoofing bug); trusting
`event.source` only (origin is the contract for cross-origin frames); accepting
`"null"` (the shell never sends as `null`; accepting it would weaken the gate for
no same-origin benefit).

### D4 - Typed clients, one connection object

`connectPlugin(options)` performs the gate setup, sends `plugin/ready` once,
awaits `shell/init`, validates the protocol major and returns a discriminated
union:

```ts
type PluginConnection =
  | { mode: 'register'; init: ShellInit; registration: RegistrationClient; close(): void }
  | { mode: 'editor'; init: EditorInit; editor: EditorClient; close(): void }
```

- `RegistrationClient.register(contribution)` sends one `plugin/register`;
  `complete()` sends `plugin/register-complete` once and awaits
  `shell/register-ack`, exposing `accepted` and `rejected`.
- `EditorClient` exposes `file`, `capabilities`, `limits`, `settings`,
  `readFile(path, encoding)`, `setDirty(flag)`, `onSaveRequest(handler)`,
  `onFileChanged(listener)`, `onDispose(listener)`, `subscribe(topic)`,
  `unsubscribe(topic)`, `onEvent(listener)`. Reads and subscribes use a
  per-frame monotonic request id and a pending map, capped at 64. A matching
  `shell/error` rejects that request with its stable code.
- `shell/init` is exposed as a typed `ShellInit` for both modes; the editor init
  extends it with `file`, `capabilities` and `limits`. Settings are a primitive
  map, exactly as the protocol sends them.
- Outstanding requests reject when the gate sees `shell/dispose`, when the
  client closes, or when the init timeout fires. On `shell/dispose` the SDK
  sends `plugin/dispose-ack` once and then drops everything.
- `shell/error` without a `replyTo` is delivered to an error listener with its
  code (for example `rate-limited`); it neither throws into a listener nor
  closes the connection. A throwing event or error listener is contained and
  does not stop later dispatch.
- If a user save handler throws, rejects, or was never registered, the SDK sends
  nothing: the protocol has no save-cancel message, so the shell's 5-second
  timeout is the defined outcome. The template always registers a handler; the
  behavior is documented instead of inventing a message.
- The UI is not the SDK's job. A plugin page may write diagnostics to its own
  hidden document, but no client renders shell UI or assumes a visible DOM.

Alternatives: separate `connectRegistration`/`connectEditor` functions (callers
must re-check the fragment mode, duplication); automatic dirty tracking from DOM
events (the plugin may be headless and the shell must not infer dirty state).

### D5 - Compatibility is package metadata plus constants

- `@exo/plugin-sdk` MAJOR = protocol MAJOR = `1`. The core exports
  `PROTOCOL_VERSION` and `SDK_VERSION`; a test asserts the package major and the
  protocol constant agree.
- Additive optional fields and new client helpers are minor releases. Removing or
  reinterpreting a wire field requires an SDK major and an OpenSpec change that
  also bumps the protocol major.
- A deprecated export stays for the rest of the current major, carries
  `@deprecated` with its replacement in the JSDoc, and is removed only at the
  next major. There is no removal inside a major.
- The manifest `schemaVersion`, `engines.exo` range and shell version are
  independent: the SDK does not parse, validate or rewrite a manifest. The
  template pins `schemaVersion: 1` and `engines.exo: ">=0.1.0"`; a future
  manifest schema change is a manifest-contract change, not an SDK bump.
- A protocol mismatch produces `ExoProtocolError` with `code:
  'unsupported-version'`, `expected` and `received`, and no phase message is
  sent. The template's negative page renders the error; the shell's plugin log
  records `unsupported-version`.

The SDK version is `1.0.0` even though the shell is `0.1.0`. The two version
lines are deliberately different: the shell has its own release cadence, while
the SDK major is a protocol statement. The handshake never infers capabilities
from the shell version.

Alternatives: a `0.x` SDK plus a `SUPPORTED_PROTOCOL` lookup (the "major equals
protocol" rule is then only convention); making the SDK version follow the shell
version (a shell patch would imply an SDK release).

### D6 - The template is a headless, storage-free plugin

The controller connects, registers `**/*.template.txt` against `editor.html`,
completes and reports the ack in `#observation` and the title. The editor
connects, exposes metadata, requests the file, reports dirty, and on a save
request answers with the loaded text plus a `[template save N]` marker so a
round-trip is observable. External changes re-read and mark dirty; dispose
acknowledges and stops. There is no textarea and no visible UI, matching the
hidden-frame architecture. State is mirrored in `#observation` and the title for
devtools, because the frame is hidden.

The page never touches `localStorage`, IndexedDB or `parent.document`. That is
required for the same-origin deployment, where the sandbox is `allow-scripts`
only. The development server runs on port 5175 (the fixture owns 5174) with
`server.cors` enabled, so the same pages also run cross-origin against
`http://localhost:5173`.

The negative page is a separate Vite input under `negative/`. It calls
`connectPlugin({ protocolVersion: '2' })` (an explicit diagnostic option, still
defaulting to the constant) and renders the named error. Its own manifest is
`exo-manifest-mismatch.json`; it is not referenced by the normal template
manifest.

Alternatives: a visible textarea (the frame is hidden; it would be false UI); a
second fixture server (duplicates the existing one); no negative page (the
actionable-error criterion would only be unit-tested).

### D7 - Deploy the template child path after the shell budget check

`npm run build` keeps building only the shell. CI then builds the template with
`EXO_TEMPLATE_BASE_PATH=/exo-editor/plugin-template/` and copies
`packages/plugin-template/dist` into `apps/shell/dist/plugin-template` **after**
the bundle budget, CSP and custom-element checks have run. The uploaded Pages
artifact therefore contains both, while the budget continues to measure the shell
only. A small copy script validates the source directory, refuses symlinks and
fails if `exo-manifest.json` is missing from the copy.

The deployed manifest URL is
`https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json`. It is
same-origin with the shell, so the consent dialog shows the same-origin warning
and the frame gets `allow-scripts` only; the template's no-storage design is what
makes that pass. The dev server remains cross-origin, so both sandbox paths are
exercised.

Alternatives: adding template JS to the shell budget (confuses shell size with
plugin size); a second Pages site (needs a separate repository); local-only
verification (violates the repository's acceptance rule).

### D8 - Conformance uses the shell's real sessions

`apps/shell/src/plugins/sdk-conformance.test.ts` imports `@exo/plugin-sdk` as a
development dependency and drives the real `RegistrationSession` and
`HandlerSession` through `FakeFrameTransport`:

- The shell posts through `FakeFrame.window.postMessage`; the test bridge hands
  that envelope to the SDK transport with `origin = shellOrigin` and
  `source = shellWindow`.
- The SDK posts through its transport; the bridge calls
  `frame.emit(envelope, pluginOrigin, sdkWindow)` so the shell's existing
  source/origin checks run unchanged. For a same-origin opaque case the bridge
  emits origin `"null"`, as the browser would.
- Negative cases feed `shell/init` from the wrong origin, wrong source, wrong
  mode and wrong session, and a `shell/error unsupported-version`, then assert
  the SDK rejects or ignores and the shell state does not change.
- The handler case uses the existing `MemoryWorkspaceProvider` + `Session` test
  setup, so reads, version checks, save results and disposal are the real ones.

This is the "conformance test against the shell's protocol fixtures" the roadmap
asks for, and it is stronger than a second fake shell because the SDK cannot
quietly agree with its own mock. The fixture remains hand-rolled so there is an
independent implementation of the same contract.

### D9 - The shell never imports the SDK at runtime

`@exo/plugin-sdk` is a `devDependency` of `@exo/shell`, used only by
`sdk-conformance.test.ts`. A new composition guard rejects any production import
of `@exo/plugin-sdk` from `apps/shell/src`, and a post-build
`check-dist-no-sdk` script fails if the SDK marker appears in the deployed
bundle. The template is built separately, so no template code can enter the
shell bundle either. The bundle budget is unchanged.

Alternatives: making the SDK a shell runtime dependency to share types (couples
the product to an authoring package and gives the SDK bundle presence for no
runtime need); type-only imports of the SDK (still a build coupling and a guard
exception to explain).

### D10 - Tooling covers the new workspaces without changing the shell gate

Root `typecheck` and `test` run across workspaces; lint and format run from the
repository root so `packages/**` is covered. The template gets `dev`, `build`,
`typecheck` and `test` scripts; the SDK gets `typecheck` and `test`. CI adds the
template build and copy steps after the existing shell checks, and the deploy job
keeps uploading the same artifact path. `AGENTS.md` documents the new commands
and the deployed template URL.

The fixture's `npm run dev:plugin` stays on 5174; the template uses
`npm run dev:template` on 5175. Neither is a verification target.

## Risks / Trade-offs

- **SDK and shell drift apart** → conformance tests drive the real sessions, and
  the hand-rolled fixture remains a second implementation. A protocol change
  that misses the SDK fails the shell test suite, not a deployed plugin.
- **The SDK source export is nonstandard for consumers** → packages are private
  and every consumer is in-repo; publishing is explicitly deferred. A future
  publish adds a build without changing the API.
- **A same-origin first-party template cannot use storage** → the template is
  storage-free by design and the deployed check proves it; cross-origin
  development still has the looser sandbox available.
- **Deploying the template grows the Pages artifact** → the shell budget runs
  before the copy, so shell size stays honest; the template is small static
  output and has its own build check.
- **The negative page could be mistaken for a supported plugin** → it lives under
  `negative/`, has its own manifest and is documented as a compatibility
  diagnostic only.
- **A user save handler that throws leaves the shell waiting** → the SDK
  documents the 5-second timeout as the outcome instead of inventing a
  save-cancel message; a future contract change can add one.
- **Duplicate protocol knowledge in SDK, shell and fixture** → intentional
  independent implementations, tied together by conformance tests rather than
  shared code.

## Migration Plan

- No stored data, workspace file or manifest changes. Existing plugins and the
  fixture keep loading unchanged.
- The shell deploy gains `/plugin-template/` as a static child path; it is
  inert until a workspace's `exo.json` references its manifest.
- Backend-free and secret-free: the deploy remains the normal push to `main`
  through `verify` and Pages.
- Rollback removes the two packages and the copy step; the shell and existing
  plugins are unaffected. Once the template manifest is documented, rollback is
  forward-only for anyone who added it, so record the deployed evidence before
  archiving.

## Open Questions

None. Package paths, SDK major semantics, deployment location and conformance
scope are decided above and reflected in the delta spec and tasks.
