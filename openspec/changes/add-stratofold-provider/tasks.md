# Tasks

## 1. Dependency and contract groundwork

- [x] 1.1 Add `@stratofold/client` exactly `0.11.0` to `apps/shell/package.json` dependencies; verify `npm install` writes the exact version to the lockfile, `npm ls @stratofold/client` shows no transitive dependencies, and a fresh `npm ci` succeeds
- [x] 1.2 Update `docs/contracts/workspace-api.md` with the remote-provider rules the delta specs add (provider selection and identity, permission-gated vs remembered restore, credential ownership, the folder-unsupported state offering remote connect) and a Stratofold provider subsection; verify `openspec validate add-stratofold-provider --strict` passes and each new contract sentence maps to a requirement in the delta
- [x] 1.3 Build the deterministic fake Stratofold server test double (`fetch` + `createXhr` seams, `ls`/`stat`/`/files`/`upload`/`mkdir`/`mv`/`rm`/`tokens/me`); verify a client-level test lists, stats and uploads through it without a real server

## 2. Adapter read path

- [x] 2.1 Implement `capabilities()` and `open()` with an injected client, deriving `writable` from the role, `watchable: false`, `caseSensitive: false`, and a non-secret descriptor id; verify a unit test covers editor, viewer and public capabilities plus descriptor-id stability across opens
- [x] 2.2 Implement `list()` (one level, plus recursive recursion) and `stat()` with path joining, RFC3339 → epoch milliseconds and directory `size: 0`; verify the conformance list/stat cases pass against the fake server
- [x] 2.3 Implement `read()` with `maxBytes` (pre-stat, `Content-Length`, post-transfer length), fresh-buffer copy, directory rejection and abort mapping; verify `too-large`, `not-a-file` and `aborted` tests fail when the checks are removed
- [x] 2.4 Run `runProviderConformance('stratofold', …)` against the fake server and make the whole suite green

## 3. Adapter write and mutation path

- [x] 3.1 Implement `write()` with `ifVersion` → conditional upload, `create` parent creation, root/directory pre-checks and a post-write `stat`; verify conformance passes for version rotation and stale-version `conflict` without overwriting
- [x] 3.2 Implement `mkdir`, `remove` and `move` with the documented pre-checks (target, parent, source, destination, non-recursive listing) and post-move `stat`; verify conformance plus the edge tests: rename onto an existing file without `overwrite`, non-recursive remove of a non-empty directory, missing source
- [x] 3.3 Implement the error mapping for `unauthorized`, `forbidden`, `notfound`, `conflict`, `rejected`, `retryable`, `server`, network failure and abort; verify a table-driven test asserts each Exo code and that no provider message or stack trace escapes
- [x] 3.4 Race the signal-less calls (`list`, `mkdir`, `move`, `remove`) against the caller's signal and reject `aborted`; verify the abort test and a dispose test showing no late callback mutates state

## 4. Connection lifecycle

- [x] 4.1 Implement connection validation: editor/viewer token discovery through a sentinel-vdir client followed by a rebuilt client, public mode validated with `list("")`, and a mismatch between the supplied and resolved directory rejected; verify tests assert one `tokens/me` request for discovery, no token in any request URL, and distinguishable unreachable/wrong-token/mismatch errors
- [x] 4.2 Implement the connection store (IndexedDB `connections` store, opt-in write, clear on forget) with a memory implementation for tests; verify session-only connections are absent after reload, remembered ones round-trip, and forgetting deletes the record
- [x] 4.3 Wire the credential-rejected callback for real `unauthorized`/`forbidden` responses only; verify a test flips the remote state on a 401 and shows the callback does not fire for session-level containment denials

## 5. Runtime, UI and plugin boundary

- [x] 5.1 Replace the hardcoded provider factory with provider-kind entries and a persisted kind marker, treating a pre-existing handle record with no marker as `folder`; verify runtime tests restore each kind, refuse a mismatched record, and open a remote workspace when folder workspaces are unsupported
- [x] 5.2 Add `connectRemote`, `disconnect` and reconnect flows that reuse `activate()`'s teardown, including the dirty-document guard before a reconnect switch; verify a cross-provider switch test shows no surviving tabs, documents, plugin registrations or config, and reconnect caches nothing
- [x] 5.3 Add the connect dialog, the Workspace settings section (connection details without the token, remember/forget, disconnect, reconnect), the two commands and the unsupported/empty-state entry points; verify component tests cover validate/deny/remember/forget and that the token never appears in rendered output
- [x] 5.4 Render the reconnect banner naming the workspace with working reconnect and disconnect actions; verify a test asserts the name, the absence of automatic retries, and the return to no workspace after disconnect
- [x] 5.5 Confirm the plugin path is unchanged on a remote workspace: `forPlugin` still denies `/exo.json` and `/.exo/**`, and no frame message carries the credential; verify with a test that fails if the reserved-path guard or the credential redaction is removed

## 6. Documentation and roadmap

- [x] 6.1 Rewrite the status, API-surface, discovery and residual-gap sections of `docs/providers/stratofold.md` for the published 0.11.0 client; verify no "blocked on npm" claim remains and `npm run format:check` passes
- [x] 6.2 Update the P1 row and exit criteria in `ROADMAP.md` and the D17 consequence in `docs/architecture.md`; verify the roadmap no longer reports the npm blocker and `openspec validate --all` passes

## 7. Integration and deployed verification

- [x] 7.1 Run the full local gate (`npm ci`, `lint`, `format:check`, `typecheck`, `test`, `build`, bundle budget, dist CSP, dist elements) and confirm every command passes
- [x] 7.2 Measure the bundle delta from `@stratofold/client` and record it in the change; verify `npm run budget` passes with any limit change justified by the measured number
- [ ] 7.3 Against `https://mode777.github.io/exo-editor/`, connect a real Stratofold vdir, browse, open and save a text file, reload and restore, switch away, and assert a viewer/public workspace is read-only; verify the network log shows no token in a URL and the bundle contains none
- [ ] 7.4 Revoke the deployed token server-side and confirm the reconnect state appears with no silent retry; record the observed behaviour
- [ ] 7.5 Check remote mode in Chromium and Firefox (Safari if reachable) and record the browser matrix result; if the deployed acceptance checks cannot be completed, leave this group open rather than substituting a local dev server

## Workflow follow-up

- Archive the change after the deployed evidence and the project review requirements are satisfied.
- Sync the delta specs into `openspec/specs/` and confirm `openspec validate --all` passes afterwards.
