# Design

## Context

See `proposal.md` for motivation. The current shell has a `WorkspaceRuntime` that
attaches a `PluginConfigStore` to one session at a time, a settings dialog with a
Plugins section, and a document/explorer stack that must not be touched in this
layer. `exo.json` validation already produces a strict, all-or-nothing snapshot
with per-entry fields; the host consumes that snapshot rather than re-reading the
file.

Constraints that shape the approach:

- The contracts in `docs/contracts/plugin-manifest.md` and
  `docs/contracts/plugin-protocol.md`, and their specs, are normative. This change
  may clarify them but cannot add an undocumented message, field or fallback.
- There is no backend and no secret. Consent lives in `localStorage`; manifests
  are fetched directly from the plugin origin with CORS; the shell origin serves
  the shell and may serve a first-party fixture.
- The deployed CSP is a meta tag, not a header, and is fixed by the
  `editor-shell` spec. It must be changed in this layer because it currently
  cannot use the `http://localhost` manifest allowance the manifest contract
  grants.
- The JS budget currently has 3,425 gzip bytes of headroom (111,575 of 115,000).
  A new runtime dependency must be measured and budgeted deliberately.
- Layer 3 verification already solved the native-picker problem by writing an
  OPFS-backed directory handle into the shell's IndexedDB record. Layer 4 reuses
  that harness against the deployed site.

## Goals / Non-Goals

**Goals:**

- One host object owns the whole enabled-entry lifecycle and survives a
  workspace switch without leaking a fetch, timer, frame or registry entry.
- Selection is deterministic from `exo.json`, not from network or handshake
  timing.
- Sandbox and origin validation are structural: the frame transport exposes the
  raw source/origin, and the state machine cannot reach registration without a
  valid ready and consent.
- The host can be tested without real cross-origin iframes, and the deployed
  checks use real frames.

**Non-Goals:**

- Handler frames, file requests, saves, dirty state, external-change
  notifications, events, plugin settings, SDK/template or Monaco.
- A JSON Schema engine, a general glob library or a full semver implementation
  beyond the `semver` package's `satisfies`.
- Rendering plugin icons, marketplace metadata or manifest-supplied HTML.
- Preserving old consent records across a manifest capability change.

## Decisions

### D1. Module layout and flow

```text
exo.json (layer 3 store)
        │  valid snapshot, declaration order
        ▼
PluginHost ── manifest.ts ──► fetch + validate + resolve entries + fingerprint
        │
        ├── consent.ts ──► fingerprint, consent store, deny memo
        │
        ├── frame.ts ──► FrameTransport (DOM / fake)
        │
        ├── registration.ts ──► ready/init/register/ack state machine
        │
        ├── registry.ts ──► registered editors + match(path)
        │
        └── status + log ──► React snapshot / settings surface
```

New modules live under `apps/shell/src/plugins/`: `manifest.ts`, `glob.ts`,
`consent.ts`, `frame.ts`, `registration.ts`, `registry.ts`, `host.ts` and
`version.ts`. React surfaces are `ConsentDialog.tsx` and additions to
`PluginSettings.tsx`. Pure logic stays out of React so the security tests can run
without a rendered workbench.

### D2. Manifest fetch, validation and entry resolution

`manifest.ts` implements the contract's fetch options and error vocabulary. It
is injected with `fetch`, a clock and an abort signal, so tests never touch the
network and the host can abort on detach.

- The timeout is a 5 s `AbortController`; a URL whose response is not 2xx is
  `http-status`; a `Content-Type` that is not `application/json` or `*+json` is
  `invalid-manifest`; the body is streamed and cancelled past 256 KiB, yielding
  `too-large`.
- `response.url` is the final URL. It defines the manifest origin, consent key and
  entry base. A redirect to a non-`https` origin other than localhost is
  `unsupported-origin`. If a test double returns no `response.url`, the requested
  URL is the fallback.
- A cross-origin fetch rejection is reported as `cors` with a message naming the
  origin and saying a network failure is possible; a same-origin rejection is
  `network`. Browsers do not expose the distinction, so the message is honest
  rather than pretending to know.
- Validation is a hand-written mirror of the `exoManifest` branch of
  `schema/exo.schema.json`, like the layer 3 config validator. It rejects unknown
  fields at every level, `contributes.configuration`, out-of-range values,
  duplicate globs and the reserved permission rules. A parity test reads the
  schema from disk and pins the constants and patterns.
- Entry resolution follows the contract: relative HTML with no query, fragment or
  `..`; resolve against the final manifest URL; same origin; inside the directory
  tree of the resolved controller entry. Percent-encoded dot segments (`%2e`,
  case-insensitive) are rejected in declared and resolved entry paths as well,
  because a server may decode them after the browser's dot-segment removal and
  land outside the displayed root. The plugin root is stored as the path with a
  trailing slash and displayed as `origin + rootPath`.
- `engines.exo` is checked with `satisfies(SHELL_VERSION, range)`. An invalid
  range is `invalid-manifest`; a valid range that excludes the shell is
  `incompatible-engine`. The manifest's `version` is checked with the schema's
  SemVer pattern, not a second parser.
- The icon is validated but not rendered in this layer. It is not part of the
  fingerprint and no plugin-supplied URL is loaded as an image.
- Validated manifests are kept in memory on the host record and dropped on stop
  or workspace switch. They are never written to storage.

Rejected alternatives: adding a JSON Schema engine (runtime weight and a second
source of truth), `fetch` then `arrayBuffer` (a hostile server can force a large
allocation before the size check), and accepting the declared URL rather than
`response.url` (a redirect would make the consent origin a lie).

### D3. Version and engine checking

The shell's package version becomes `0.1.0`. `src/version.ts` exports
`SHELL_VERSION` and a test pins it to `apps/shell/package.json`, so the value
used in `shell/init` and in `engines.exo` cannot drift. The contract's example
range `^0.1.0` is then usable; keeping `0.0.0` would reject the documented
example for no benefit.

`semver` is added as a runtime dependency and only its range functions
(`semver/functions/satisfies.js` and `semver/ranges/valid.js`) are imported, not
the package index. `validRange` distinguishes an invalid range from a valid one
that excludes the shell, which `satisfies` alone cannot. An isolated production
bundle of that import measured 19.4 kB raw / 5.96 kB gzip with the local bundler,
so the current 3.4 kB headroom will not absorb it. The budget is re-measured after
the change and raised deliberately by the measured amount plus a small margin; the
budget check remains the gate. A hand-written range parser was rejected: the
contract says SemVer range, and a partial parser would reject valid ranges or
quietly mis-evaluate them. A `*`-only shortcut was rejected because it makes
`engines.exo` decorative.

### D4. Identity, declaration order and concurrency

Plugin identity is `${finalOrigin}::${pluginId}`. The host numbers enabled
entries by their position in `exo.json`; that number is the plugin order used for
initialization and selection. Within a plugin, registration messages are numbered
in arrival order. Registry sorting is priority descending, then plugin order
ascending, then registration order ascending.

- Enabled manifests are fetched with a concurrency limit of 4. The host waits for
  the batch to settle before resolving identities, so a duplicate identity is
  decided by declaration order, not by which fetch finished first.
- Duplicate identities: the lowest declaration index keeps the identity; every
  later entry becomes `failed` with `duplicate-identity`. It gets no consent
  prompt and no frame. Two origins with the same id are distinct.
- Consent is queued in declaration order and shown one at a time. Approved or
  already-consented plugins start registration immediately; registration frames
  are also capped at 4 concurrent mounts. Timers start per frame, so a slow
  plugin cannot delay an unrelated timer.
- Registration order is assigned from declaration order when the entry is
  accepted, not from `register-complete` arrival. That is what makes equal
  priority deterministic.

Alternative considered: fully concurrent fetch and registration. It removes the
queue but makes equal-priority selection depend on network timing, which the
spec forbids. Serial fetch/registration is simpler still but lets one broken
plugin block every later one for 10 s each.

### D5. Consent store, fingerprint and prompt

`consent.ts` computes the exact fingerprint input from the contract with
`JSON.stringify` on a literal object, hashes it with `crypto.subtle.digest`
(SHA-256, lowercase hex), and stores one JSON object under
`localStorage["exo.consent.v1"]`.

- The digest function and storage are injectable for tests. A missing
  `crypto.subtle` is a hard `internal` failure before any frame is mounted, not a
  silent weaker hash.
- The store is parsed and structurally validated on read. A malformed store is
  discarded, not repaired. Individual malformed records are ignored. A storage
  write failure grants for the session, logs `consent-store-failed`, and warns in
  the status; blocking a plugin the user just approved because storage is full
  would be worse than asking again after reload.
- Deny is an in-memory `Set` on the host, keyed by identity. It survives a
  workspace switch because it is an origin-level decision for the page session,
  but not a reload. Revoking removes the persistent record and stops the plugin;
  it sets the status to `awaiting-consent` but does not reopen the dialog
  automatically.
- The prompt is one React modal. It renders the exact origin in a `<code>`
  element, the manifest name/id/version/publisher as text, the controller entry
  and root, every editor entry with its label and glob, plain-language
  permissions, write access, and the same-origin warning. A homepage link is
  `https` only and uses `noopener noreferrer`. There is no `dangerouslySetInnerHTML`
  and no plugin-supplied markup.
- Focus starts on Deny. Escape and a backdrop click deny for the session and
  advance the queue; there is no implicit approval. Approve is an explicit button.
- If a manifest changes while loaded, its new fingerprint is compared with the
  stored record. A mismatch is treated as absent; the old record stays until the
  user approves the new one, matching the contract's replacement rule.

Alternative considered: persisting consent per workspace. Rejected because
consent is an origin-level decision and the contract says machine-wide.

### D6. Frame transport and sandbox construction

`frame.ts` defines a small transport boundary:

```ts
interface FrameTransport {
  open(options: {
    url: string
    sandbox: 'allow-scripts' | 'allow-scripts allow-same-origin'
    onMessage: (event: { data: unknown; origin: string; source: Window | null }) => void
    onLoadError: () => void
  }): { window: Window | null; close(): void }
}
```

`DomFrameTransport` creates a hidden iframe with `allow=""`,
`referrerpolicy="no-referrer"`, `loading="eager"`, no fullscreen and no popups,
sets the sandbox before the source, appends it to a host container, and registers
a single window `message` listener. Messages are routed by `event.source`
identity; unknown sources are dropped before the host sees them. `close()` removes
the iframe and its route and is idempotent. A fake transport in tests records the
URL and sandbox, and lets a test emit a message with a chosen source and origin;
that is how the security cases run without browser frames.

Sandbox selection is by final manifest origin equality with the shell origin:

- cross-origin: `allow-scripts allow-same-origin`;
- same-origin: `allow-scripts` only, which yields an opaque origin.

The frame URL keeps `exo-host`, `exo-mode=register` and `exo-session` in the
fragment. Session ids are random UUIDs with a `getRandomValues` fallback, injected
for tests. For an opaque same-origin frame the shell sends messages with
`targetOrigin: '*'` because no origin can be named; for cross-origin frames the
target is the exact plugin origin. This is the only `*` use and it carries no
file content in this layer.

### D7. Registration state machine

`registration.ts` is driven only by transport events and timers:

```text
mount ──► awaiting-ready ──plugin/ready──► awaiting-register ──complete──► acknowledged ──► closed
              │ 10 s                            │ 10 s                         │ 250 ms
              └──────────── timeout ────────────┴──────── timeout ─────────────┘
```

- Message validation order is source (transport), envelope (`exo: 1`, string
  type, id/replyTo rules, payload shape), origin mode, phase, then payload. An
  origin failure on a known source is counted; three violations close the frame
  with `protocol-violation`. A source failure is dropped silently.
- `plugin/ready` is accepted once. It must carry protocol version `"1"` and the
  session id for an opaque frame. A wrong major gets `shell/error`
  `unsupported-version` and the frame closes before registration. A wrong session
  id is dropped and counted. A second ready is a violation.
- `shell/init` is sent only after a valid ready. It contains the protocol version,
  mode `register`, session id, plugin id/version, shell version/origin, workspace
  name, theme, permissions, locale and no file fields.
- `plugin/register` accepts additive contributions, validates each one against the
  manifest's declared glob (exactly one declaration after the duplicate-glob
  rule) and the approved root, resolves the entry against the manifest URL, and
  collects rejections with an index and reason. A missing label defaults to the
  manifest label; a supplied label must be 1-40 characters; priority always comes
  from the manifest. Identical glob+entry pairs are deduplicated.
- `plugin/register-complete` commits the pending contributions, sends
  `shell/register-ack` with accepted glob strings and rejected entries, marks the
  plugin active (even with zero editors), and schedules removal 250 ms later.
- A timeout, load error, unsupported version, revocation or removal closes the
  frame and discards pending contributions. Nothing is committed before complete,
  so rollback is simply dropping the pending map.
- Handler-phase messages in registration mode are protocol violations and never
  reach the session. The host has no reference to a plugin workspace facade in
  this layer.

Alternatives considered: committing each registration as it arrives (a plugin
that never completes would leave partial state), and trusting the manifest's
editor entry instead of the registered entry (the protocol explicitly allows a
sibling/descendant page chosen at registration time).

### D8. Registry and glob matching

`registry.ts` is a pure structure with `add(identity, pluginOrder,
contributions)`, `remove(identity)` and `match(path)`. It compiles each unique
glob once and matches paths without the leading slash. The supported syntax is
the contract subset: `*` within a segment, `**` across segments, `?`, character
classes and brace alternation. Negation, backslashes, extglobs and regex
constructs are rejected at manifest validation and again at registration.
Matching is case-sensitive; workspace path comparison may be case-insensitive,
but editor globs are literal POSIX patterns in v1. This is documented as a
limitation rather than silently changing pattern semantics.

`match()` returns every matching contribution ordered by priority, plugin order
and registration order. The first is the selected editor; the rest are the
"Open with..." candidates. Layer 5 consumes this list; layer 4 exposes and tests
it only.

### D9. Workspace integration and reconciliation

`WorkspaceRuntime` owns one `PluginHost` for its lifetime. `activate()` detaches
the old host and config store before releasing the old session, then attaches the
config store and host to the new session after the workspace is ready. Teardown
order is host, config, session, provider, documents, matching the architecture
document.

The host subscribes to `PluginConfigStore` and reconciles on a stable key of
`status + entries(manifest, enabled)`. Reconciliations are serialized. For a valid
snapshot it:

- starts enabled entries that are new;
- stops entries that disappeared or became disabled;
- leaves unchanged enabled entries alone;
- stops everything and clears records/registry when the snapshot becomes invalid
  or absent, while keeping the log until the workspace changes.

Every async step captures the host generation and the entry identity. Publishing
checks both before mutating the snapshot, so a late manifest, timer or message
from the old workspace is inert. This is the same generation pattern the config
store and session already use.

Deny decisions survive a workspace switch; status, registry, pending prompts,
fetches, frames and log do not. Consent records persist in `localStorage`.

### D10. Status, errors and the settings surface

The host snapshot contains records, an optional consent request and a log. A
record has the manifest URL and declaration index, a phase from `disabled`,
`loading`, `awaiting-consent`, `denied`, `registering`, `active` or `failed`, the
manifest summary when known, its identity, its registered editors, and a failure
code plus phase. Error codes are the manifest vocabulary plus `duplicate-identity`,
`loading-failed`, `protocol-violation` and `internal`. Messages are bounded to
200 characters and never contain a response body, file text, bytes or a path
outside the declared entries.

The Plugins section joins host records to `exo.json` entries by manifest URL. It
shows manifest metadata and exact origin when known, status, consent actions and
editor labels, and a log list with time, id/origin, phase and code. A failed row
shows the code and phase; an awaiting row has Review; a granted row has Revoke
(two-step confirmation in the row) and a denied row has no automatic retry. The
log is capped at 200 entries and cleared on workspace switch. The consent dialog
is rendered by `App` so it is available even when settings is closed, and sits
above the settings backdrop.

### D11. CSP localhost allowance

The manifest contract permits `http://localhost` manifest and entry URLs, but the
deployed CSP is `frame-src https:` and `connect-src 'self' https:`, so a deployed
shell can validate such a declaration but never fetch or frame it. The policy
becomes:

```text
frame-src https: http://localhost:*;
connect-src 'self' https: http://localhost:*;
script-src 'self'
```

No other plain-HTTP origin is allowed. This is a narrow exception for the
documented development origin and does not affect the `script-src` policy or the
no-`unsafe-*` rule. `csp.ts`, `csp.test.ts`, `check-dist-csp.mjs`, the
architecture document and the `editor-shell` spec must change together.

### D12. Verification strategy

Two fixture origins use the same files:

- `apps/shell/public/plugin-host-fixture/` is copied into the deployed site and
  served same-origin at `https://mode777.github.io/exo-editor/plugin-host-fixture/`.
  It exercises the `allow-scripts`-only opaque sandbox and proves storage is
  unavailable.
- `apps/shell/scripts/serve-plugin-fixture.mjs` serves the same directory on
  `http://localhost:5174` with `Access-Control-Allow-Origin: *` and a JSON
  content type. This is the cross-origin fixture the deployed shell frames; if a
  browser treats it as mixed content, the same script can serve HTTPS on 5174
  with a generated certificate and Chrome can be launched with
  `--ignore-certificate-errors` for the verification run. The product policy
  already permits both forms.

The fixture pages use inline scripts because they are plugin documents, not part
of the shell bundle, so they do not affect the JS budget. The controller sends
ready, waits for init, registers the declared glob and completes; the editor page
is present for registration but is not opened in this layer. The fixture reports
its sandbox and storage observation in the shell's status and in its own DOM so
the headless driver can read it.

Verification runs against the deployed URL with Chrome for Testing on the remote
verification host, using the layer 3 OPFS/IndexedDB workspace harness because the
native directory picker is not headless-drivable. The checks cover: cross-origin
registration and the active status; deny with a network log showing the manifest
request but no entry request and no iframe; permission/glob change re-prompt;
sibling page inside the root without a re-prompt; same-origin plugin with no
`allow-same-origin` and no storage; missing CORS error naming the origin; a
fixture that never sends ready timing out after 10 s with the phase named; live
add/remove; workspace-switch teardown; and a duplicate identity being reported.
Screenshots and the network log stay on the verification host.

## Risks / Trade-offs

- **CORS and network failures are indistinguishable in browsers** → Report `cors`
  for a cross-origin rejection with a message that names the origin and admits a
  network failure is possible; report `network` for same-origin. The contract and
  spec say this explicitly.
- **`semver` exceeds the current budget** → The isolated import is measured at
  ~6 kB gzip; the budget is raised once, explicitly, after the real build
  measurement, and stays enforced. The alternative is a misleading home-grown
  range parser.
- **`postMessage('*')` to same-origin opaque frames** → No file content is sent in
  this layer; init contains only metadata. Layer 5 must revisit the target-origin
  rule before sending content, and the protocol contract now records the
  constraint.
- **Headless cross-origin frames are hard to drive** → The transport boundary
  keeps state-machine security tests in jsdom/fakes, and the deployed check uses
  real frames in Chrome. A failure that only appears in a real browser is caught
  by the deployed acceptance run, not by unit tests.
- **Localhost fixture may be blocked as mixed content in some browsers** → Chrome
  treats localhost as potentially trustworthy and the CSP now allows it; if the
  verification browser blocks it, serve the same fixture over HTTPS on 5174 and
  record the certificate exception as verification-only.
- **Consent prompt fatigue** → Persisted fingerprints, one prompt at a time,
  declaration order, and a session-wide deny keep repeats predictable. Cosmetic
  manifest changes do not re-prompt.
- **Plugin-supplied display strings** → Name, publisher, labels and globs are
  rendered as text with React escaping, length-bounded by the schema, and never
  as HTML. The homepage link is validated `https` and opened with
  `noopener noreferrer`.
- **Percent-encoded traversal in entry paths** → Rejected before the browser sees
  the URL, in addition to dot-segment normalization and root containment. The
  test fails if the `%2e` check is removed.
- **Concurrent registration frames** → Capped at four mounts, with per-frame
  timers and idempotent close, so a stuck plugin cannot starve the queue or leave
  a timer behind.
- **Case-sensitive globs on a case-insensitive workspace** → Documented as v1
  behavior; a future change can add capability-aware matching without changing
  the manifest format.
- **Duplicate-identity policy needs explanation in the UI** → The later entry is
  shown as failed with `duplicate-identity` and both manifest URLs remain visible;
  it is never silently dropped.

## Migration Plan

There is no persisted data migration. Deploying this change makes existing
`exo.json` entries start fetching and prompting for consent; users who do not want
a plugin can disable it in settings. Consent is stored under a new versioned key
and is ignored by the previous build if the commit is reverted. Reverting the
commit restores the layer 3 behavior; the static site has no server state to
clean up. The shell version bump, `semver` dependency and budget update ship in
the same commit. After deployed verification, update `ROADMAP.md` layer 4 status,
the `AGENTS.md` current-state paragraph, and add the fixture command to the
documented commands.

## Open Questions

None that block the task breakdown. Icon rendering and capability-aware glob
casing are explicitly deferred and do not change the manifest or protocol.
