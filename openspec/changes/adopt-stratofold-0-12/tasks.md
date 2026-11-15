# Tasks

## 1. Client upgrade and zero-byte files

- [x] 1.1 Pin `@stratofold/client` to exactly `0.12.0` in `apps/shell/package.json`, regenerate `package-lock.json` with `npm install`, and verify `npm ls @stratofold/client` shows `0.12.0` with no transitive dependency
- [x] 1.2 Add provider tests in `providers/stratofold/provider.test.ts` that create an empty file with `write(path, new Uint8Array(), { create: true })`, read it back as zero bytes, replace a non-empty file with empty content, and assert the returned size is 0 and the version rotates; verify `npm test -- src/workspace/providers/stratofold/provider.test.ts` passes
- [x] 1.3 Add an empty-write conflict test that supplies a stale `ifVersion`, asserts `conflict`, and confirms the original non-empty bytes are unchanged; verify the test fails if the adapter drops `ifVersion` and passes when restored
- [x] 1.4 Update `docs/providers/stratofold.md` for 0.12.0: remove the empty-file residual row and the zero-byte upstream ask, record the server-version requirement for empty uploads, and verify no "0.11.0" claim remains outside historical context
- [x] 1.5 Update the cancellation note in `providers/stratofold/errors.ts` to the current client version if it still names 0.11.0, and verify `npm run format:check` and `npm run typecheck` pass

## 2. Connection-string connect flow

- [x] 2.1 Add a resolver in `providers/stratofold/connection.ts` that wraps the client's `parseConnectionString`, maps `ConfigurationError` to a new `invalid-connection-string` connect error with a fixed non-secret message, and returns the existing `ConnectRequest` shape; verify unit tests cover a valid string, a wrong prefix, an unknown version, invalid base64/JSON and a missing field
- [x] 2.2 Verify the resolver applies a corrected server override while keeping the string's vdir and token, and that no error message or thrown value contains the input string; add tests that assert both
- [x] 2.3 Add the password-style "Connection string" field to `ConnectRemoteDialog.tsx`, parse on change, prefill server/vdir/token and clear the raw field on success, keep partial input quiet until submit, and submit the existing `ConnectRequest` shape with the vdir whenever present; verify component tests cover paste, prefill, raw-field clearing, malformed submit with no network request, and a server-origin correction
- [x] 2.4 Add a persistence test that connects with a connection string and remember enabled, serializes the stored record, and asserts it contains the server, vdir, name, role and token but neither `sfconn_v1_` nor the original input; verify `connection-store.test.ts` and `runtime.remote.test.ts` pass
- [x] 2.5 Update the remote-provider section of `docs/contracts/workspace-api.md` with connection-string entry, local parsing, the origin override and the no-raw-string storage rule; update `docs/providers/stratofold.md` sections 5 and 6; verify the text matches the `remote-workspace` delta and `npm run format:check` passes

## 3. Integration and deployed verification

- [x] 3.1 Run the full local gate (`npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, bundle budget, dist CSP, dist elements) and confirm every command passes
- [x] 3.2 Measure the bundle delta from 0.12.0 plus the dialog work; either confirm the existing `apps/shell/budget.json` limit still passes or raise it with the recorded measured number and headroom
- [x] 3.3 Against `https://mode777.github.io/exo-editor/` and a real 0.12.0 Stratofold instance, paste a minted connection string, confirm the workspace mounts with the correct server, directory and role, and record that the raw string appears in no request URL, DOM text or stored record
- [x] 3.4 Against the deployed shell, paste a malformed connection string and a string with a corrected server origin; confirm the first fails locally with no request and the second mounts through the corrected origin
- [x] 3.5 Against the deployed shell, use New File in a writable remote workspace, open the empty file, save non-empty content and then save empty content over it; confirm size 0, the rotated version and the expected bytes at each step
- [x] 3.6 Update `ROADMAP.md` with the `adopt-stratofold-0-12` provider-track row, status and exit criteria, update the verification section of `docs/providers/stratofold.md`, and confirm `openspec validate --all` passes

## Workflow follow-up

- Archive the change after the deployed evidence and review requirements are satisfied.
- Sync the `remote-workspace` delta into `openspec/specs/` and confirm `openspec validate --all` passes afterwards.
