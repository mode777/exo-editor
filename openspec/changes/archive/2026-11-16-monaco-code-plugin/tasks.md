# Tasks

## 1. Manifest rendering field and consent

- [x] 1.1 Add `rendering` (`"hidden" | "frame"`, default `"hidden"`) to the `fileEditor` schema, `ManifestFileEditor`, the allow-list in `parseFileEditors` and the registry candidate; verify manifest tests accept omitted and `"frame"`, reject `"overlay"` and pin the schema field
- [x] 1.2 Include the frame-rendering flag in `fingerprintInput` only when it is `"frame"` and update the consent prompt to disclose frame rendering; verify hidden manifests keep their existing fingerprint, frame manifests change it, and the dialog test shows the disclosure
- [x] 1.3 Update `docs/contracts/plugin-manifest.md` and the `plugin-manifest` delta with the field, default, validation, consent fingerprint and prompt behavior; verify the contract text and delta agree and `openspec validate monaco-code-plugin` passes

## 2. Visible handler surface

- [x] 2.1 Extend `FrameOpenOptions`/`FrameHandle` with an optional surface controller (`show(bounds)`, `hide()`) and implement it in `DomFrameTransport` as a fixed-position, focusable iframe over the measured slot while registration and hidden handlers stay `display: none`; verify frame tests cover show/hide, bounds, focus and that `close()` removes the route and element
- [x] 2.2 Pass `rendering` from `EditorCandidate` through `HandlerPool`/`HandlerSession` and add pool methods to attach, measure and detach the active document's slot with `ResizeObserver` and window resize; verify handler tests cover visible activation, hide on detach without disposal, and no surface for hidden contributions
- [x] 2.3 Add the document-area slot, editor metadata and CSS for `rendering: "frame"` documents, keeping header, breadcrumbs, Save, notices and fallback states outside the frame; verify `DocumentArea`/document-store tests cover the slot for the active tab, hidden-while-inactive behavior and the normal failure/text fallback paths
- [x] 2.4 Update `docs/contracts/plugin-protocol.md`, `docs/architecture.md` and the `plugin-protocol`/`plugin-file-editors` deltas for the scoped hidden-frame rule and visible handler surface; verify every changed sentence matches the specs and `openspec validate monaco-code-plugin --strict` passes

## 3. Monaco reference plugin

- [x] 3.1 Scaffold `apps/code-plugin` (`@exo/code-plugin`) with Vite multi-page build, base path `EXO_CODE_PLUGIN_BASE_PATH`, dev server on 5176 with CORS, typecheck/test scripts and `monaco-editor`; verify a clean `npm install` links the workspace and `npm run build --workspace @exo/code-plugin` emits `plugin.html` and `editor.html`
- [x] 3.2 Add `public/exo-manifest.json` with a stable id, read/write plus `events:subscribe`, priority `10`, `rendering: "frame"` and the TypeScript, JavaScript, JSON and Markdown globs; verify the shell's real manifest validator accepts it and a plugin test checks every declared page exists in the source tree
- [x] 3.3 Implement the controller page with the SDK only: connect, register the declared glob, complete and report the acknowledgement; verify the source scan rejects hand-written envelopes/listeners and the controller test covers accepted and rejected acknowledgements
- [x] 3.4 Implement the editor page: bootstrap, read once, create Monaco with the extension language, configure inline editor/JSON/TypeScript workers, apply the init theme and `theme/changed`, and mirror path/language/state in the status strip; verify unit tests cover language mapping, theme mapping, worker selection and the no-LSP source scan
- [x] 3.5 Implement editing, dirty, save and external-change behavior with a generation counter, exact model text on save, dirty clearing only when no later edit occurred, conflict/timeout retention and a non-destructive external-change notice; verify tests cover each transition and the 5 MiB/`limits.maxRequestBytes` guard sends no read
- [x] 3.6 Add `apps/code-plugin/README.md` with the dev URL, deployed URL, no-storage rule, 5 MiB guard, save-initiation limitation and manual checks; verify every documented path and command exists

## 4. Deployment, example workspace and guards

- [x] 4.1 Add `apps/shell/scripts/copy-code-plugin.mjs` and `check-dist-no-monaco.mjs`, plus root `dev:code`, `build:code`, `deploy:copy-code` and `check:dist-no-monaco` scripts; verify the copy rejects symlinks and a missing manifest, and the guard fails on an injected Monaco marker but passes the real shell dist
- [x] 4.2 Update `.github/workflows/ci.yml` so the no-Monaco check, code-plugin build and copy run after the shell budget/CSP/custom-element checks and before upload; verify the YAML order and that the uploaded artifact contains `code-plugin/exo-manifest.json` while the budget remains shell-only
- [x] 4.3 Add `examples/code-plugin-workspace/` with an absolute deployed-manifest `exo.json` and small TypeScript, JSON and Markdown files; verify the manifest is valid strict JSON, every referenced plugin page exists in the deployed layout and the README explains how to open it
- [x] 4.4 Update `README.md`, `AGENTS.md` and `ROADMAP.md` with the plugin entry points, commands, layer 9 status and the explicit no-Monaco/no-privileged-path statement; verify every documented command exists and the roadmap exits are traceable to a task

## 5. Integration and deployed verification

- [x] 5.1 Run the full local gate: `npm ci`, lint, format check, typecheck, tests, shell build, bundle budget, CSP, custom elements, no-SDK, no-Monaco, template build/copy and code-plugin build/copy; verify every command passes
- [x] 5.2 Deploy by pushing `main`; verify the CI `verify` job is green and the Pages artifact serves `code-plugin/exo-manifest.json` at the documented URL
- [x] 5.3 Against the deployed shell with an OPFS folder workspace, add the deployed manifest, approve consent, open `.ts`, `.json` and `.md` files and confirm the visible Monaco frame, `sandbox="allow-scripts"`, no storage and no page errors
- [x] 5.4 Against the deployed shell, edit and save each language, reload with the saved content, confirm dirty/conflict/external-change behavior and the 5 MiB guard, then disable the plugin and confirm the text fallback
- [x] 5.5 Against the deployed shell, serve the same build on a cross-origin `localhost:5176`, confirm `sandbox="allow-scripts allow-same-origin"`, storage availability and an edit/save round-trip
- [x] 5.6 Confirm the deployed shell bundle contains no Monaco marker, the shell has no Monaco dependency, and the budget/CSP/custom-element results are unchanged; record the evidence and update the roadmap status
- [x] 5.7 Run `openspec validate --all` and confirm the new capability, the three modified capabilities, the change artifacts and the untouched specs all validate

## Workflow follow-up

- Archive the change after the deployed evidence and the project's review requirements are satisfied.
- Sync the four deltas into `openspec/specs/`, update the contract cross-links and re-run `openspec validate --all`.
