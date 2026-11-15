# Stratofold workspace provider

Status: implemented by the OpenSpec change `add-stratofold-provider`; deployed
verification is recorded in that change. The adapter and the connect flow are in
`apps/shell/src/workspace/providers/stratofold/`.

Upstream: `@stratofold/client` 0.11.0, published on the public npm registry and
verified from the tarball on 2026-11-15 (`latest`, zero runtime dependencies,
ISC, ESM with types). It is pinned exactly, because the package is `0.x`.

Contract: [`workspace-access`](../contracts/workspace-api.md). This provider
implements the existing session contract; it does not change it.

Roadmap: [Provider track P1](../../ROADMAP.md#provider-track-parallel-non-blocking).
The track can start after layer 3 and should land after layer 4 because both
touch `WorkspaceRuntime` and the app composition.

## 1. Purpose and scope

Stratofold turns an SSH/SFTP directory into a virtual directory (`vdir`) served
over HTTPS. One vdir maps to one Exo workspace and one vdir-scoped bearer token
maps to one workspace credential.

- **Remote, opt-in, direct.** The browser talks to Stratofold directly with a
  header-only bearer token or anonymously for a public vdir. There is no Exo
  backend, proxy, or server-held secret.
- **Not sync or cloud storage.** The remote directory remains the source of
  truth. Exo adds no synchronization, offline mode, background upload, or
  multi-root behavior.
- **The first remote provider.** It is the path out of D10's Chromium-only
  folder limitation and proves that the provider interface can back a non-local
  store. It is a parallel track, not a numbered layer (D17).
- **v1.x scope by default.** Shipping it in the v1 release would be a deliberate
  scope change to `docs/vision.md`; leaving it on the parallel track does not
  change v1.

## 2. Contract mapping

The provider lives in `apps/shell/src/workspace/providers/stratofold/` and
implements `WorkspaceProvider`/`WorkspaceHandle`. Paths are Exo-normalized: `/` is
the vdir root, every other path loses its leading slash before it reaches the
client. No provider method was added for this backend.

| Exo surface | Stratofold 0.11.0 | Adapter notes |
| --- | --- | --- |
| `capabilities()` | `tokenInfo()` role, or no token for a public vdir | `writable` only for an `editor` token; `watchable: false`; `persistent` follows the credential-storage choice; `caseSensitive: false` (conservative, see section 4) |
| `open()` | No request: the connect flow already validated the connection | The connect form takes a server URL and a token (or a public directory id) and validates before the provider exists, so `capabilities()` can be synchronous and a failed connection never mounts. |
| `restore(id)` | Stored connection + `tokenInfo()` (public: `list`) | The active-workspace marker selects the provider kind. A remembered connection is revalidated before it mounts; a rejected credential mounts nothing and surfaces the reconnect state. |
| `list(path, {depth, signal})` | `list(path)` returns `{name,size,dir,modtime,version}` | One level only; `depth: 'recursive'` is adapter recursion. Directories map to `size: 0`. `modtime` is RFC3339; Exo wants epoch milliseconds. |
| `stat(path, {signal})` | `stat(path, {signal})` returns `{path,name,kind,size,mtime,version}` | Direct mapping; root is `""`; no parent listing needed. |
| `read(path, {signal, maxBytes})` | `read(path, {signal})` returns the raw `Response` | Enforce `maxBytes` from `Content-Length` or a capped stream. `stat` first so a directory is `not-a-file` rather than `index.html` or a 404. Map a fetch abort to `aborted` when the signal fired. |
| `write(path, data, {signal, ifVersion, create})` | `upload(path, body, {signal, ifVersion})` | `ifVersion` maps to `If-Match`; a 412 maps to `conflict` and carries the current version. `create: false` uses `ifVersion: "*"` or a pre-stat; a versionless 412 maps to `not-found`. `create: true` may need a parent `mkdir`. The upload response has no `version`, so `stat` after success to return a `FileStat`. |
| `mkdir(path, {recursive, signal})` | `mkdir(path)` creates missing parents; an existing directory succeeds | Pre-`stat` the target to produce `already-exists`/`not-a-directory`; pre-`stat` the parent when `recursive` is false. No in-flight signal. |
| `remove(path, {recursive, signal})` | `remove(path)` is always recursive; a missing path succeeds | Pre-`stat` for `not-found`; pre-`list` for a non-empty directory when `recursive` is false. No in-flight signal. The current explorer always passes `recursive: true`. |
| `move(from, to, {overwrite, signal})` | `move(from, to)` uses `PosixRename`, which replaces an existing file | Pre-`stat` the destination when `overwrite` is false and throw `already-exists`; pre-`stat` the source for `not-found`; `stat` the destination after success. No in-flight signal. |
| `requestPermission()` | No role escalation | Omit it. A viewer token stays read-only; "reconnect with an editor token" is a shell UI flow, not a permission grant. |
| `watch()` | Absent | Omit it; `watchable: false` makes the session poll open documents on focus. |

Error mapping:

| Stratofold result | Exo code |
| --- | --- |
| 401 `unauthorized` | `permission-denied` (surface a reconnect affordance) |
| 403 `forbidden` | `permission-denied` |
| 404 `notfound` | `not-found`, or a pre-checked `not-a-file`/`not-a-directory` |
| 412 `conflict` | `conflict` (use `error.version` to resync) |
| 400/other 4xx `rejected` | pre-check where possible; otherwise `io` |
| 503/network `retryable` | `io` |
| other 5xx `server` | `io` |
| abort with an aborted signal | `aborted` |

## 3. What 0.11.0 provides

- **`stat(path)`** at `POST /api/sf/vdirs/{vdirId}/stat` with
  `{kind, size, mtime, version}` and a working root path. This removes the
  parent-`ls` workaround and makes kind/existence pre-checks cheap.
- **A shared opaque version.** `ls` entries, `stat`, the `/files` ETag, and
  conditional upload all use the same value. It combines the remote signature
  (kind, size, whole-second mtime) with a durable per-`(vdir, path)` publication
  generation, so a same-size upload in the same second rotates the version.
- **Conditional upload.** `If-Match` is checked when the upload publishes, under
  a process-local per-target lock, with a generation reservation covering the
  check and rename. A mismatch returns `412` with the current version and does
  not publish; the client maps it to `kind: "conflict"` and exposes
  `error.version`. `If-Match: *` requires the target to exist.
- **CORS** allows `if-match` on upload.
- **Signals** on `stat`, `read` and `upload`.

Verified against the published `dist/*.d.ts` and `client.js`:

- The constructor requires a non-empty `vdir`; `tokenInfo()` is the only method
  that does not use it.
- `UploadBody` is `Blob | File | ArrayBuffer`, so the adapter passes an
  `ArrayBuffer` slice of the Exo buffer.
- `ifVersion` must be an unquoted strong version or `"*"`.
- Uploads use `XMLHttpRequest` behind an injectable `createXhr`, which is the
  test seam; JSON calls use `fetch`.
- `list`, `mkdir`, `move` and `remove` accept no `AbortSignal`.

See Stratofold's
[ADR 0015](https://github.com/mode777/stratofold/blob/main/docs/decisions/0015-content-version-and-conditional-writes.md)
and the `filesystem-api`, `client-library` and `file-server` specs.

## 4. Remaining gaps and adapter decisions

| Area | 0.11.0 behavior | Adapter workaround | Residual risk |
| --- | --- | --- | --- |
| `remove` | Always recursive; missing path is success | Pre-`stat`; pre-`list` for `recursive: false` | A file added after the listing is still deleted by `rm`; current UI always passes `recursive: true` |
| `move` | Always replaces a file destination; a missing source with an existing destination succeeds | Pre-`stat` source and destination | TOCTOU between stat and rename; a retry after an unacknowledged move can look like `not-found` because the source is gone |
| `mkdir` | Existing directory succeeds; parents always created | Pre-`stat` target and parent | Harmless race: a concurrent create reports success instead of `already-exists` |
| Cancellation | No signal on `list`, `mkdir`, `move`, `remove` | Pre-check; race the promise against the signal; optionally use own `fetch` for the JSON calls | A rejected promise does not cancel the remote operation; a mutation can land after a workspace switch |
| Errors | `conflict` is typed; `already-exists`, `not-a-file`, `not-a-directory`, `too-large`, `quota-exceeded`, `aborted` are not | Pre-checks for the common cases; map the rest to `io` | Some server-side failures degrade to a generic message |
| Directory `read` | A directory serves `index.html` or 404 | `stat` first and reject non-files | One extra request; TOCTOU |
| Recursive `list` | One level | Recurse over `ls` | N requests, partial snapshot, abort only between calls |
| Case sensitivity | Not exposed | Declare `caseSensitive: false` | A legitimate `EXO.JSON` on a case-sensitive host is treated as reserved; acceptable for the shell's names |
| Post-write stat | Upload returns `{path,size}` only | `stat` after a successful write/move | A network failure after the server applied the change can look like a failed save; a retry needs care |
| Symlinks | `ls` uses `Lstat`; `stat`/`read` follow | Accept for v1; do not claim symlink parity | A symlinked directory can appear as a file; versions can differ between `ls` and `stat` |
| External edits | Detected by size and whole-second mtime | None; document it | An external same-size edit in the same second is invisible (Stratofold's documented residual) |

## 5. Credentials, security and browser behavior

- **Token shape.** A vdir-scoped `sf_v1_` bearer token with role `viewer` or
  `editor`, optional expiry, and immediate revocation. A public vdir needs no
  token and is read-only in Exo.
- **Discovery.** `tokenInfo()` returns the vdir id/name, role, expiry, last use
  and a non-secret hint. Because the constructor requires a `vdir`, the connect
  form asks for a server URL and a token only: validation builds a throwaway
  client with the sentinel `vdir` `"-"`, calls `tokenInfo()` once
  (`/api/sf/tokens/me`, the only request the sentinel client makes), then
  rebuilds the client from `info.vdir.id`. A test asserts the sentinel never
  appears in a directory URL. Public discovery is impossible without a token, so
  the form asks for the directory id and validates it with `list("")`.
- **Storage.** Session-only by default. The connect form's opt-in writes
  `{ server, vdir, name, role, token }` to the `exo-remote` IndexedDB database;
  "disconnect and forget" deletes it. Never bundle a token, put it in a URL, log
  it, or send it to a plugin frame. Revoking it in Stratofold surfaces as an
  explicit reconnect state: the adapter stops issuing requests and only a
  reconnect or disconnect clears it.
- **Reserved paths.** The session enforces `/exo.json` and `/.exo/**` for plugin
  requests. Stratofold itself has no knowledge of Exo, so anyone holding the
  vdir token can read those paths through another client. This is the same trust
  model as a local folder (other local apps can read it), but it matters for a
  shared vdir and must be stated in the connect UI or docs.
- **No URL capabilities for plugins.** `fileUrl()` and `temporaryUrl()` are not
  exposed through the provider or the plugin protocol. The v1 document renderer
  is text-only, so they are not needed.
- **Transport.** Stratofold must be served over HTTPS in production; the
  deployed CSP allows `https:` and `http://localhost:*`. CORS is supported by
  the server, and the client uses `credentials: "omit"` with header-only auth.

## 6. Distribution

**Resolved - `@stratofold/client` 0.11.0 is published.**

- The registry has `0.11.0` as `latest`, with `0.0.0-bootstrap.0` and
  `0.0.0-stage` as the only other versions. `npm view @stratofold/client@0.11.0`
  and a tarball inspection agree with the repository's `client/package.json`:
  zero runtime dependencies, ISC, ESM with types, `sideEffects: false`.
- Exo depends on the exact version `0.11.0` and a clean `npm ci` from the lockfile
  installs it. The old options - vendoring a tarball, or a git subdirectory
  dependency - are no longer needed and are not used.
- The release workflow still publishes by tag; a future `0.11.x`/`0.12` needs a
  deliberate version bump here, not an automatic upgrade.

## 7. Verification plan

- **Automated, against the published client.** `runProviderConformance` runs
  against a deterministic in-memory Stratofold server injected through the
  client's `fetch` and `createXhr` seams
  (`providers/stratofold/fake-server.ts`), and the edge tests cover:
  - same-size, same-second save: the version rotates, and a stale `ifVersion`
    gets `conflict` without publishing;
  - rename onto an existing file without `overwrite`: `already-exists`, both
    files intact;
  - non-recursive remove of a non-empty directory: fails without deleting;
  - abort on `list`/`mkdir`/`move`/`remove`: rejects `aborted` immediately, with
    the documented residual that the remote call is not cancelled;
  - directory `read`: `not-a-file`, never `index.html`;
  - missing path: `not-found`; root `stat` works;
  - every HTTP failure class maps to the documented Exo code without leaking the
    server message or a stack trace;
  - discovery makes exactly one `tokens/me` request and no token appears in a
    request URL;
  - the session still denies `/exo.json` and `/.exo/**` through `forPlugin`, and
    the credential is absent from the snapshot, the plugin host state and the
    plugin config state.
- **Deployed verification.** Against `https://mode777.github.io/exo-editor/`:
  connect to a Stratofold vdir, browse, open a text file, edit/save, reload and
  restore, switch away, revoke the token, and confirm a viewer/public workspace
  is read-only. Inspect the network log: no token in URLs; no token in the
  bundle; no plugin message receives one. Never use a local dev server or local
  build as evidence.
- **Packaging.** A clean `npm ci` from the registry, the CI `verify` job, the
  bundle budget and the CSP checks. Measured: the deployed bundle grew from
  130,600 to 135,376 gzip bytes (+4,776 - the client plus the adapter, connect
  dialog and settings), so the `js` limit moved from 136,000 to 142,000 with
  6,624 bytes of headroom.

## 8. Upstream asks

| Priority | Ask | Why |
| --- | --- | --- |
| P1 | `vdir` optional for discovery, or a vdir-independent `whoami` | Removes the sentinel-vdir workaround and the coupling to constructor validation |
| P1 | `rm { recursive: false }` plus `{ removed: boolean }` | Non-recursive delete and `not-found` without a pre-list race |
| P1 | `mv { overwrite: false }` returning 409/412 | No-clobber rename; the current default silently replaces the destination |
| P1 | `AbortSignal` on `list`, `mkdir`, `move`, `remove` | Contract-conformant teardown and workspace switches |
| P1 | Typed errors: `already-exists`, `not-a-file`, `not-a-directory`, `aborted`, `too-large`, `quota-exceeded` | Removes pre-check round trips and ambiguous `io` |
| P2 | Recursive `ls` (`depth`) | Avoids N+1 requests for quick-open/search |
| P2 | Upload/move response includes the new `stat`/`version` | Saves a post-operation stat and avoids a successful write looking failed |
| P2 | `caseSensitive` capability | Lets the adapter declare the real value instead of the conservative `false` |

## 9. Resolved questions

- **Scope.** The provider stays a parallel track (D17), not part of the v1
  release gate. Shipping it inside v1 would need a vision/scope change and a
  release-readiness browser-matrix entry.
- **Credential storage.** Session-only is the default. The connect form's
  "remember this connection" opt-in writes the record to IndexedDB and states
  that the token stays in this browser; disconnect deletes it.
- **Multiple workspaces.** One at a time. A new connection replaces the active
  workspace through the normal switch path; the store keeps only the last
  remembered connection.
- **Browser matrix.** Remote mode is not restricted to Chromium by a browser
  API. The deployed checks run in Chromium and Firefox and the result is recorded
  in the change; Safari is checked when reachable.
