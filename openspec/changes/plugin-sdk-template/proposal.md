# Proposal

## Why

Layers 4-7 shipped the complete v1 plugin protocol, but every consumer still
hand-rolls it. The deployed fixture re-implements the envelope, origin checks,
handshake, request correlation, registration, reads, saves, disposal and event
subscriptions in plain JavaScript. That duplicates security-relevant logic for
every author and leaves no compatibility promise connecting the SDK version, the
protocol major and the manifest schema. Layer 8 gives plugin authors a typed
client, a starter template and a frozen compatibility policy before the Monaco
reference plugin (layer 9) depends on them.

## What Changes

- Add `packages/plugin-sdk` (`@exo/plugin-sdk`, private, zero runtime
  dependencies). A DOM-free core carries the protocol constants, envelope
  parsing and typing, request/reply correlation and the protocol state machines;
  an explicit browser adapter reads `exo-host`, `exo-mode` and `exo-session` from
  the fragment and supplies `parent`/`window`. Importing the package outside a
  browser SHALL NOT touch `window`, `document`, `location` or `parent`.
- Add typed clients for the four plugin surfaces: handshake (`plugin/ready` /
  `shell/init`), registration (`plugin/register`, `plugin/register-complete`,
  `shell/register-ack`), editor (`request-file`, `dirty`, save request/result,
  file-changed, dispose) and events (`subscribe`, `unsubscribe`, `shell/event`),
  with typed v1 payloads, stable error codes and injected-transport tests.
- Enforce the plugin side of the trust boundary: accept only messages whose
  source is the parent frame and whose origin is the `exo-host` origin, verify
  that `shell/init.sessionId` and `.mode` echo the fragment, reject every
  unexpected or malformed envelope, never post to `*`, and reject all pending
  requests on disposal. A protocol-major mismatch SHALL surface a named error
  carrying the expected and received versions, not hang or stay blank.
- Add `packages/plugin-template`: a minimal headless plugin built only on the
  SDK, with a controller page, an editor page, a manifest, a Vite build, a
  cross-origin dev server on port 5175, typecheck and a conformance test. The
  template contains no hand-written envelope, handshake, registration or handler
  protocol code.
- Deploy the built template as a same-origin child path of the shell site
  (`/exo-editor/plugin-template/`) after the shell budget check, so the
  registration, edit and save exit criteria are demonstrated against the
  deployed shell. The dev server remains a second origin; the template uses no
  storage and works under both sandbox modes.
- Freeze the compatibility policy: SDK `MAJOR` equals the protocol major it
  speaks, additive optional wire fields and API additions are minor releases,
  removals or reinterpretations require a new SDK and protocol major, deprecated
  APIs remain for the rest of the current major, and the manifest
  `schemaVersion`, `engines.exo` and shell version stay independent of the SDK.
- Prove conformance against the shell rather than a second mock: run the SDK's
  handshake, registration, editor and event clients against the real
  `RegistrationSession` and `HandlerSession` in `apps/shell` tests, including
  wrong-origin, wrong-source, wrong-mode, wrong-session and unsupported-version
  cases. Add a bundle guard asserting the shell does not import the SDK.
- Add `docs/contracts/plugin-sdk.md` and cross-link the protocol and manifest
  versioning sections to it. Update `README.md`, `docs/architecture.md`,
  `AGENTS.md` commands, CI and `ROADMAP.md`.

**Explicit non-goals:** publishing `@exo/plugin-sdk` or the template to a
registry, changing any wire message, field, limit or sandbox rule, changing the
manifest schema or consent fingerprint, plugin-rendered shell UI, plugin
storage for same-origin plugins, a documentation site or marketplace, and the
Monaco plugin (layer 9). The hand-rolled `plugin-host-fixture` stays independent
as a protocol oracle and is not migrated to the SDK.

## Capabilities

### New Capabilities

- `plugin-sdk`: the typed plugin client (envelope, handshake, registration,
  editor and event surfaces), its strict origin/source and fragment identity
  checks, DOM independence, the SDK/protocol/manifest compatibility and
  deprecation policy, the starter template, conformance against the shell, and
  the rule that the shell does not depend on the SDK.

### Modified Capabilities

None. The shell's protocol, manifest, host, editor, event and settings
requirements do not change; the new capability consumes them.

## Impact

- `packages/plugin-sdk/` (new): package manifest, TypeScript config, source
  modules, unit tests and the injected fake transport used by conformance tests.
- `packages/plugin-template/` (new): manifest, controller/editor pages, Vite
  config, dev server settings, typecheck and tests, plus a protocol-mismatch
  diagnostic page for the actionable-error check.
- `apps/shell/src/plugins/sdk-conformance.test.ts` (new): SDK clients against
  the real registration and handler sessions and the frame test harness.
- `apps/shell/package.json`: development dependency on the workspace SDK; no
  runtime import.
- `package.json`, `eslint.config.js`, `.github/workflows/ci.yml`: workspace
  scripts, lint/format scope, SDK/template typecheck and tests, template build,
  and the post-budget deploy copy.
- `apps/shell/scripts/copy-template.mjs` (new): the post-build copy into the
  deployed site.
- `docs/contracts/plugin-sdk.md` (new), `docs/contracts/plugin-protocol.md`,
  `docs/contracts/plugin-manifest.md`, `docs/architecture.md`, `README.md`,
  `AGENTS.md`, `ROADMAP.md`.
- No new runtime dependency, no network call, no shell bundle growth; the
  existing bundle budget and CSP checks stay unchanged.
