# Tasks

## 1. Manifest permission and consent

- [x] 1.1 Add `workspace:list` to the shared schema permission enum, the shell's `PLUGIN_PERMISSIONS`, the SDK permission union and `hasWorkspaceList`, and reject `workspace:list` without `workspace:read` in the validator; verify schema/validator tests cover valid read+list, listing-only, duplicate and unknown permissions
- [x] 1.2 Add the plain-language consent line for directory listing and a fingerprint test that adding `workspace:list` re-prompts while a read-only manifest keeps its stored consent; verify the consent component test names listing and the fingerprint test fails if the permission is removed from the input
- [x] 1.3 Update `docs/contracts/plugin-manifest.md` and the `plugin-manifest` delta with the permission, read dependency, consent text, fingerprint behavior and `engines.exo` guidance; verify `openspec validate plugin-workspace-listing --strict` passes

## 2. Protocol, handler and listing broker

- [x] 2.1 Add `capabilities.directoryListing` to editor `shell/init`, send it from `HandlerSession` and document that it is a support bit, not a permission; verify a handler test pins the field and an older init shape still parses
- [x] 2.2 Add `plugin/request-list` to the editor-phase dispatch with strict shape validation (`id`, string `path`, optional string `cursor`), `workspace:list` enforcement, relative/absolute path resolution, `not-a-directory` mapping and correlated `shell/list-result`; verify tests cover first page, relative and absolute paths, missing path, file path, missing permission, malformed payload, wrong phase and reserved path
- [x] 2.3 Implement the broker's sorted snapshot cache and opaque cursor pagination: direct children only, directories before files then path, a 1,000-entry page cap, `nextCursor` only when more entries exist, a per-handler snapshot/entry cap with LRU eviction, and `not-found` for malformed, foreign or expired cursors; verify tests cover a 1,001-entry directory, page continuation, snapshot stability across create/delete and cursor expiry
- [x] 2.4 Return the minimal entry shape `{ path, kind, size? }` with `size` only for files and no `mtime`, version, content, handle, `File` or `Blob`; verify a test asserts the exact payload keys and that a subsequent read still goes through `plugin/request-file`
- [x] 2.5 Enforce four in-flight listing requests per frame, a rolling rate of twenty per second and a five-second page deadline; abort pending pages on handler disposal and workspace switch and drop late results; verify tests cover the fifth in-flight request, the rolling limit, timeout, disposal and workspace switch
- [x] 2.6 Update `docs/contracts/plugin-protocol.md` with the messages, support bit, entry shape, pagination/snapshot, `not-a-directory`, limits, timeout and security checklist; verify the contract and `plugin-protocol` delta agree and `openspec validate --all` passes

## 3. SDK client and compatibility

- [x] 3.1 Add `workspace:list` to the SDK permission type, add `not-a-directory` to the SDK shell-error code list, and add `directoryListing` to the editor capabilities parser with an absent value defaulting to `false`; verify parser tests cover a new shell, an old shell, a `not-a-directory` reply and a malformed value
- [x] 3.2 Add `EditorClient.listDirectory(path, options?)` with local `unsupported-message` and `permission-denied` preflight, correlated `plugin/request-list`, opaque cursor pass-through, entry validation, stable error propagation and disposal rejection; verify SDK tests cover first page, next page, missing permission, old shell, shell errors, malformed entry/page and dispose
- [x] 3.3 Bump the SDK to the next additive minor (`1.3.0` when `plugin-file-picker` is present), update `SDK_VERSION`, version-pinning tests and `docs/contracts/plugin-sdk.md`, and keep the SDK major equal to the protocol major; verify the documented helper and permission exist in the exported types
- [x] 3.4 Update the `plugin-sdk` delta and the contract editor-client list with `listDirectory()`, the support bit and the fallback; verify `openspec validate plugin-workspace-listing --strict` passes

## 4. Fixture and author documentation

- [x] 4.1 Add `workspace:list` to the fixture manifest, register a listing editor (for example `**/*.list.txt` with a priority above the generic `**/*.txt` fixture editor), implement a hand-rolled `plugin/request-list` flow that records entries, `nextCursor` and errors in `#observation` and the title, and add a no-list fixture path for the permission-denied check; verify the fixture serves and the README lists the manual checks
- [x] 4.2 Update `docs/guide/manifest.md`, `docs/guide/protocol.md`, `docs/guide/sdk.md` and `docs/guide/testing.md` with the permission, message, pagination, snapshot and SDK helper; verify every documented field, command and type exists and `npm run format:check` passes

## 5. Integration and deployed verification

- [x] 5.1 Run the full local gate: `npm ci`, lint, format check, typecheck, tests, shell build, budget, CSP, custom elements, no-SDK, no-Monaco, template build/copy, code-plugin build/copy, `check:dist-secrets` and `openspec validate --all`; verify every command passes
- [ ] 5.2 Push `main`, confirm the CI `verify` and Pages deploy jobs pass, and confirm the deployed fixture manifests and shell assets are current
- [ ] 5.3 Against the deployed shell, open a `*.list.txt` document, list the workspace root and a subdirectory, verify entries carry path/kind/size only, a returned path reads through the normal read flow, and reserved paths are absent
- [ ] 5.4 Against the deployed shell, verify a 1,001-entry directory paginates with `nextCursor`, a file path returns `not-a-directory`, a missing directory returns `not-found`, and a plugin without `workspace:list` gets `permission-denied`
- [ ] 5.5 Against the deployed shell, verify a workspace switch during a listing clears snapshots and returns no old-workspace path, and that disabling the plugin or closing the handler stops further pages
- [ ] 5.6 Record the deployed evidence in the change notes and update `ROADMAP.md`/`AGENTS.md` if the project tracks this post-v1 follow-up there

## Workflow follow-up

- Archive the change after the deployed evidence and the project's review requirements are satisfied.
- Sync the four deltas into `openspec/specs/` and re-run `openspec validate --all`.
