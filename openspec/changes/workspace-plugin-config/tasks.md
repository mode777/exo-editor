# Tasks

## 1. Contract and documentation alignment

- [x] 1.1 Update `docs/contracts/plugin-manifest.md` section 2 with the configuration load and refresh rules, the 256 KiB cap, the issue vocabulary and shape, the canonical key order and explicit `enabled`, and the strict-JSON/comment clarification; verify every statement has a matching requirement or scenario in the `plugin-manifest` and `editor-shell` deltas and `openspec validate workspace-plugin-config --strict` passes
- [x] 1.2 Update `docs/architecture.md` D8 and the plugin lifecycle wording so `exo.json` is strict JSON, settings owns the canonical rewrite, and comments are rejected rather than stripped; verify the wording matches the contract and adds no provider or session method
- [x] 1.3 Confirm `schema/exo.schema.json` needs no change and record why in the design or contract; verify the schema still validates the canonical and fixture documents with the project's existing checks

## 2. Validator, diagnostics and canonical writer

- [x] 2.1 Add `src/plugins/config.ts` with the v1 types, constants and a validator that requires a plain object root, `schemaVersion: 1`, a `plugins` array of at most 50 entries, exact `manifest`/`enabled` entry keys, absolute `https` or `http://localhost` URLs without credentials or fragments, and duplicate detection after URL normalization; add table-driven tests for every error plus a valid empty declaration and verify the validator returns zero usable entries on any failure
- [x] 2.2 Add a schema-parity test that reads `schema/exo.schema.json` and asserts the validator's `50` entry limit, `schemaVersion` constant, required entry keys, `additionalProperties: false` and URL patterns match the schema; verify changing a pinned schema value fails the test
- [x] 2.3 Add structured issues with `invalid-json`, `unsupported-version`, `invalid-config`, `too-many-plugins`, `duplicate-manifest`, `too-large`, `not-readable` and `conflict`, each carrying the path, JSON Pointer and entry index when known; add tests that partial failures return every issue and that no raw file text appears in a diagnostic
- [x] 2.4 Implement `serializeExoConfig` with the fixed key order (`schemaVersion`, `plugins`, `manifest`, `enabled`), explicit `enabled`, 2-space indentation and a trailing newline; add golden-byte tests and verify a missing `enabled` becomes `"enabled": true`
- [x] 2.5 Add pure structured operations for add, enable/disable and remove that start from the parsed declaration, change only the target, re-validate and serialize; verify each operation against an already-canonical fixture produces a diff limited to the intended entry or flag

## 3. Workspace-scoped configuration store

- [x] 3.1 Implement `src/plugins/store.ts` with `attach(session)`/`detach()`, generation-guarded load, a single coalesced refresh, stat-version skipping, abort-on-detach and focus/visibility listeners; add tests for load, absent, invalid, external refresh, unchanged-version skip, oversize, read failure and listener cleanup on detach
- [x] 3.2 Implement serialized writes with `ifVersion`, `create` for the first add, validate-before-write and conflict handling; add tests for canonical bytes, invalid raw text not written, stale write leaving the external content intact, and a late write after detach not mutating the new workspace
- [x] 3.3 Wire the store into `WorkspaceRuntime` with attach after session creation and detach before session disposal, and add `usePluginConfig()` to the workspace context; verify a workspace switch shows no old entries and a deferred old read cannot publish into the new snapshot
- [x] 3.4 Add the reserved-document guard to `WorkspaceRuntime.openDocument`: `/exo.json` and `/.exo/**` (case-folded when the provider is case-insensitive) must not create a tab or document and must call an injected routing callback; add a negative test that fails when the guard is removed

## 4. Plugin settings surface

- [x] 4.1 Build `PluginSettings` for the no-workspace, absent and valid states with entry rows, add-by-URL, enable/disable and remove; add render tests for each state and verify a first add creates `exo.json` and a duplicate or invalid URL leaves the file unchanged
- [x] 4.2 Add the invalid, over-limit and read-only states: render every issue with code, entry index and field, disable structured controls while invalid or read-only, and keep the explorer usable; add tests for each state and verify a 51-entry fixture reports the limit without usable entries
- [x] 4.3 Add the raw `exo.json` view with exact text, Save, Reload, dirty tracking and the canonical-format/comment warning; add tests for a successful canonical save, invalid text not written, an external edit preserved as a conflict, and the warning being present
- [x] 4.4 Add the `exo.plugins.open` command, Preferences menu entry and settings section routing, and widen the dialog styling for entry rows and the raw editor; add tests that the command and a reserved `openDocument` call open the Plugins section and create no tab
- [x] 4.5 Assert the layer loads no code: with a fetch spy and a DOM inspection, verify adding an entry makes no request to the manifest URL, creates no iframe and shows no consent prompt

## 5. Integration, security and deployment

- [x] 5.1 Add an App-level integration test with the memory provider covering missing, malformed, partial-failure and 51-entry workspaces, then add/toggle/remove, raw save, read-only and workspace switch; verify the explorer and document area keep working in every malformed case
- [x] 5.2 Add security tests that the shell can read and write `/exo.json` while `forPlugin(...)` denies read, stat, write and listing of `/exo.json` and `/.exo/**`; verify removing the reserved-path check fails the test
- [x] 5.3 Run the full repository gate from `AGENTS.md` (`npm ci`, lint, format check, typecheck, test, build, budget, CSP, elements) and `openspec validate --all --strict`; fix every failure and update `apps/shell/budget.json` deliberately with the measured size if headroom changed
- [ ] 5.4 Push `main`, wait for the verify and Pages workflows, and verify the layer 3 exit criteria against `https://mode777.github.io/exo-editor/` using fixture workspaces: missing, malformed, partial-failure and 51-entry files, add/toggle/remove, canonical diff and warning, read-only controls, raw conflict, no tab for `exo.json`, and no manifest request or frame; record the browser version and each result
- [x] 5.5 Confirm no new runtime dependency, backend, proxy or secret is present in the source or `dist`, and that the shell bundle contains no plugin runtime; verify by inspecting `package.json`, the build output and the existing composition-quality tests

## Workflow follow-up

- Archive `workspace-provider` first, then archive this change with `openspec archive workspace-plugin-config`.
- Update `ROADMAP.md` layer 3 status and exit criteria, and the `AGENTS.md` current-state paragraph, to say layer 3 is complete and layer 4 is next.
- Re-run `openspec validate --all` after archive and confirm the new requirements are present in `openspec/specs/plugin-manifest/spec.md` and `openspec/specs/editor-shell/spec.md`.
