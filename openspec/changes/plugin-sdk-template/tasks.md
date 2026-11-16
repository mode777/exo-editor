# Tasks

## 1. SDK package and DOM-free core

- [x] 1.1 Create `packages/plugin-sdk/` with a private `@exo/plugin-sdk` package at version `1.0.0`, zero runtime dependencies, `exports` for `.` and `./browser`, a TypeScript config, a Vitest `node`-environment config and `typecheck`/`test` scripts; verify `npm install` links the workspace and `npm run typecheck --workspace @exo/plugin-sdk` passes on the placeholder entry points
- [x] 1.2 Implement `src/index.ts` core constants and types: `PROTOCOL_VERSION`, `SDK_VERSION`, the v1 limits, `Envelope`, `ShellInit`, `RegistrationAck`, `FileMetadata`, event catalog payloads, `ShellErrorCode` and `ExoProtocolError`; verify unit tests pin the envelope shape, the protocol constant and the package-major/protocol-major equality
- [x] 1.3 Add the DOM-free core modules for envelope construction and parsing, plain-object and id validation, and the injected `PluginTransport` interface; verify unit tests accept valid envelopes and reject non-objects, missing `exo`, empty `type`, and over-long `id`/`replyTo`
- [x] 1.4 Add the ESLint restriction that bans `window`, `document`, `location` and `parent` in the SDK core modules, and a test that imports the package in a `node` environment with those globals absent; verify the test fails if a core module regresses to a DOM read
- [x] 1.5 Add a test helper fake transport that records posts and injects incoming `(data, origin, source)` tuples, and verify it is importable from the SDK tests without a DOM

## 2. Message gate and browser adapter

- [x] 2.1 Implement the single message gate: parent-source check, exact `exo-host` origin check, envelope validation and `shell/init` mode/session echo validation; verify tests drop a foreign origin, a non-parent source, a malformed envelope, a wrong mode and a wrong session without resolving a pending handshake
- [x] 2.2 Implement `src/browser.ts` with fragment parsing for `exo-host`, `exo-mode` and `exo-session`, absolute-http(s)-origin validation with no path/query/credentials, a `window` listener and `window.parent` posting; verify adapter tests in a jsdom test file cover a valid fragment, a missing parameter, an invalid host and a top-level page with no parent
- [x] 2.3 Verify the adapters never post with `*` and always use the exact host origin, and that the package entry point remains importable without the browser adapter
- [x] 2.4 Implement the typed handshake: send `plugin/ready` once, validate the protocol major, mode and session, expose the typed `ShellInit`, and reject with `ExoProtocolError` carrying `expected` and `received`; verify tests cover success, `shell/error unsupported-version`, a mismatched init major, a 10-second init timeout with an injected timer, and a second start not sending a second ready

## 3. Registration client

- [x] 3.1 Implement `RegistrationClient` with `register(contribution)`, `complete()` and the typed acknowledgement; verify a test registers a declared glob, completes once and resolves with accepted globs, and a second `complete()` rejects locally without a second message
- [x] 3.2 Expose rejected contributions with their index, reason and optional message; verify a test with one accepted and one rejected contribution preserves both lists and the rejection reason
- [x] 3.3 Reject registration calls on an editor-mode connection without sending a message; verify the test inspects the fake transport and finds no `plugin/register`

## 4. Editor client

- [x] 4.1 Implement the editor connection with typed `file`, `capabilities`, `limits` and `settings`, and no content before a read; verify a test opens a handler and observes metadata with an empty read list
- [x] 4.2 Implement `readFile(path, 'utf8' | 'binary')` with monotonic request ids, a 64-request pending cap, `shell/file-content` correlation and `shell/error` rejection; verify tests cover text, bytes, relative and absolute paths, an error reply that leaves another request pending, and the pending cap
- [x] 4.3 Implement `setDirty(flag)`, `onSaveRequest(handler)` and the save reply using the request id as `replyTo`, then resolve from the matching `shell/save-result`; verify tests cover dirty true/false, save success, save failure and a throwing save handler sending no content
- [x] 4.4 Implement `shell/file-changed` delivery without changing dirty state, and `shell/dispose` handling that rejects pending requests, sends `plugin/dispose-ack` once and ignores later messages; verify tests cover external change, dispose with an in-flight read, a second dispose and a late message
- [x] 4.5 Implement event subscriptions: `subscribe(topic)` resolves from `shell/subscribed` with `seq`, rejects `unsupported-topic` and `permission-denied`, `unsubscribe(topic)` sends immediately and removes the local listener, and `onEvent` delivers typed topic/seq/payload; verify tests cover each result, a throwing listener that does not stop later delivery, and the v1 payload types

## 5. Template plugin

- [x] 5.1 Scaffold `packages/plugin-template/` with a Vite multi-page build (`plugin.html`, `editor.html`, the negative page), a base path configurable through `EXO_TEMPLATE_BASE_PATH`, a dev server on port 5175 with CORS, and `build`/`typecheck`/`test`/`dev` scripts; verify `npm run build --workspace @exo/plugin-template` emits the three pages and a manifest
- [x] 5.2 Implement the controller page with the SDK only: connect, register `**/*.template.txt` against `editor.html`, complete, surface the ack in `#observation` and the title, and report bootstrap/ack errors visibly; verify the template source contains no direct `postMessage`, `exo: 1` construction or `message` listener outside the SDK
- [x] 5.3 Implement the editor page with the SDK only: expose metadata, read the file, report dirty, answer save requests with the loaded text plus a marker, re-read on external change, acknowledge dispose and mirror state into `#observation` and the title; verify a source-scan test rejects hand-written protocol code and a unit test covers the marker function
- [x] 5.4 Add `public/exo-manifest.json` with `schemaVersion: 1`, a stable id, `engines.exo: ">=0.1.0"`, `workspace:read`/`workspace:write`, the `**/*.template.txt` editor contribution with a priority above the fixture's `**/*.txt` entry and no storage usage; verify a test in `apps/shell/src/plugins/manifest.test.ts` parses the template manifest with the real validator and a template test checks every declared page exists in the source tree
- [x] 5.5 Add the negative `negative/protocol-mismatch.html` page and `public/exo-manifest-mismatch.json`; the page calls `connectPlugin({ protocolVersion: '2' })`, renders `code`, `expected` and `received`, and registers nothing; verify the build output contains both files and a test asserts the diagnostic does not send a registration message
- [x] 5.6 Add `packages/plugin-template/README.md` with the dev-origin manifest URL, the deployed manifest URL, the storage-free rule and the manual checks; verify every documented file and path exists

## 6. Deployment integration

- [x] 6.1 Add `apps/shell/scripts/copy-template.mjs` that copies `packages/plugin-template/dist` into `apps/shell/dist/plugin-template`, rejects symlinks, requires `exo-manifest.json`, and fails clearly when the source build is missing; verify a local run against a built template creates the expected tree
- [x] 6.2 Add root scripts for `dev:template`, `build:template` and `deploy:copy-template`; verify each command runs from the repository root and that the template build uses the `/exo-editor/plugin-template/` base path
- [x] 6.3 Update `.github/workflows/ci.yml` so the verify job runs the template build and copy **after** the shell budget, CSP and custom-element checks, and so the uploaded Pages artifact contains `plugin-template/exo-manifest.json`; verify the YAML order and a local equivalent of the step sequence
- [x] 6.4 Verify the shell bundle budget still measures only shell assets: run the budget check before the copy and confirm it reports the same basis as before the template exists

## 7. Shell conformance and isolation

- [x] 7.1 Add `@exo/plugin-sdk` as a development dependency of `@exo/shell`; verify a clean `npm install` resolves it from the workspace and the shell production build does not include it
- [x] 7.2 Extend `apps/shell/src/quality/composition-guard.test.ts` to reject any production import of `@exo/plugin-sdk`; verify the guard passes now and fails when a temporary production import is added
- [x] 7.3 Add `apps/shell/src/plugins/sdk-conformance.test.ts` with a bridge between `FakeFrameTransport` and the SDK fake transport, and run the real `RegistrationSession` through the SDK handshake, registration and acknowledgement; verify the shell session reports no protocol violation and the SDK sees the accepted globs
- [x] 7.4 Extend the conformance test to the real `HandlerSession` using the existing `MemoryWorkspaceProvider` + `Session` setup: init, read, dirty, save result, external change and dispose; verify the shell's version, permission and dispose checks are exercised
- [x] 7.5 Add negative conformance cases for a wrong origin, wrong source, wrong mode, wrong session and `shell/error unsupported-version`; verify each is dropped or rejected and the shell's state and logs show no unauthorized change
- [x] 7.6 Add `apps/shell/scripts/check-dist-no-sdk.mjs`, a root `check:dist-no-sdk` script and a CI step after the build; verify it passes on the real dist and exits non-zero when the SDK marker is injected into a built asset

## 8. Tooling and documentation

- [x] 8.1 Extend root `lint`, `format`, `format:check`, `typecheck` and `test` to cover `packages/**` (with explicit app/package globs so `package-lock.json` and build output stay out) while keeping the shell gate unchanged; verify each root command passes and includes the SDK and template tests
- [x] 8.2 Add `packages/plugin-sdk/README.md` with install, handshake/registration/editor/event examples, the DOM-free core and browser adapter split, and the compatibility policy; verify every code sample compiles against the package's exported types
- [x] 8.3 Add `docs/contracts/plugin-sdk.md` with the package layout, transport and gate rules, client surfaces, compatibility policy, template deployment and conformance; verify its normative text matches the `plugin-sdk` delta and every message it names exists in `plugin-protocol.md`
- [x] 8.4 Cross-link the SDK contract from the protocol and manifest versioning sections without changing their existing requirements; verify the links resolve and no message, field or limit is duplicated with a different value
- [x] 8.5 Update `docs/architecture.md` (packages are real, shell has no SDK runtime dependency, deploy includes the template child path), `README.md` (SDK/template entry points) and `AGENTS.md` (new commands and deployed template URL); verify each documented command exists and the manifest URL is the built path

## 9. Integration and deployed verification

- [x] 9.1 Run the full local gate: `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, the bundle budget, `check:dist-csp`, `check:dist-elements`, `check:dist-no-sdk`, `npm run build:template` and the copy script; verify every command passes
- [x] 9.2 Deploy by pushing `main`; verify the `verify` job is green and the Pages deployment contains `plugin-template/exo-manifest.json` at the documented URL
- [x] 9.3 Against `https://mode777.github.io/exo-editor/`, add the deployed template manifest to `exo.json`, approve consent and confirm the same-origin warning, then open a `*.template.txt` file and confirm the SDK-based controller registered and the editor frame mounted
- [x] 9.4 Against the deployed shell, confirm the editor reads the file, reports dirty, saves the marker, reloads with the saved content and disposes without a protocol violation; confirm the template's hidden frame reports no storage access
- [x] 9.5 Against the deployed shell, add `exo-manifest-mismatch.json` and confirm the shell log reports `unsupported-version` and the diagnostic page's console surfaces the expected/received protocol versions; confirm no editor registers
- [x] 9.6 Confirm the deployed shell bundle contains no SDK or template code and that the shell budget, CSP and custom-element results are unchanged apart from the separate template child path
- [x] 9.7 Update `ROADMAP.md` with the layer 8 status, deployed evidence and the real SDK/template commands, and confirm the status and commands match `AGENTS.md`
- [x] 9.8 Run `openspec validate --all` and confirm the new capability, the change artifacts and the untouched existing specs all validate

## Workflow follow-up

- Archive the change after the deployed evidence and the project's review requirements are satisfied.
- Sync the `plugin-sdk` delta into `openspec/specs/`, confirm the contract cross-links still resolve, and re-run `openspec validate --all`.
