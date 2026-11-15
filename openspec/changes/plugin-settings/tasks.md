# Tasks

## 1. Manifest configuration

- [x] 1.1 Add `ManifestConfiguration`/`ManifestSetting` types, the setting-key and value limits (`50` settings, `50` enum values, `64`-character key, `500`-character description, `4096`-character string value), and a `parseConfiguration` function to `apps/shell/src/plugins/manifest.ts`; verify `manifest.test.ts` accepts boolean/string/number settings and rejects an unknown configuration field, an unknown setting field, a bad key, more than 50 settings, a missing/mismatched default, an invalid enum (empty, duplicate, mixed type, missing default), a non-workspace scope, an empty or long description, a non-finite number and a long string
- [x] 1.2 Replace `"configuration": false` in `schema/exo.schema.json` with `configuration`, `setting` and `settingKey` definitions matching the parser, and extend the schema-parity test to pin the new constants and shape; verify the parity test reads the schema and passes
- [x] 1.3 Add `configuration` to the validated `PluginManifest` object and update `cloneRecord` in `plugins/host.ts` so the host snapshot exposes it without sharing mutable state; verify a host test reads the configuration from a loaded manifest record
- [x] 1.4 Keep `contributes.configuration` out of the consent fingerprint and add a test that two manifests differing only in configuration produce the same digest, while a permission or glob change still changes it; verify `consent.test.ts` covers both directions
- [x] 1.5 Update `docs/contracts/plugin-manifest.md` with the active field row, the `configuration.properties` shape, the limits and the fingerprint exclusion; verify the text matches the `plugin-manifest` delta and its scenarios

## 2. Shell-owned settings store

- [x] 2.1 Add `apps/shell/src/plugins/settings.ts` with `SettingValue`/`SettingValues`, declaration validation, default resolution, the 4096-character string and finite-number rules, and a `PluginSettingsStorage` seam with IndexedDB and memory implementations; verify unit tests cover all three types, missing values using defaults, enum membership, invalid edits leaving the active and stored values unchanged, and the length/number limits
- [x] 2.2 Implement `PluginSettingsStore` with `subscribe`/`getSnapshot`, `attach(workspaceId)`, `detach()`, `declare(identity, configuration)`, `values(identity)` and `set(identity, key, value)`; verify tests cover idempotent declarations, per-identity isolation, default fallback for an invalid stored value with an `invalid-stored` issue, unknown stored keys being dropped, a read failure starting from defaults with a storage warning, and a write failure keeping the session value with a warning
- [x] 2.3 Add a generation guard so a late IndexedDB read from a released workspace cannot mutate the next workspace, and publish a new snapshot only when values or issues change; verify a deferred-storage test attaches workspace A, switches to B, resolves A's read and observes B unchanged
- [x] 2.4 Add the store to `WorkspaceRuntime`: construct it with an `onChange` callback, await `attach(descriptor.id)` before host and handler attachment, call `detach()` in `deactivate` and `dispose`, and expose it through `usePluginSettings` in `workspace/context.tsx`; verify runtime tests cover attach, switch reset, same-workspace reload values and a late load being ignored

## 3. Protocol and event delivery

- [x] 3.1 Add `settings: SettingValues` to `shell/init` in `HandlerSession` and `RegistrationSession`, always present and `{}` when nothing is declared; verify handler and registration tests assert current values, declared defaults and the empty map
- [x] 3.2 Pass the store into `PluginHost`, declare each manifest's configuration when `finalize` assigns identity (skipping duplicate identities), and pass `values(identity)` into `RegistrationSession`; verify host tests cover a valid manifest declaring settings, a failed manifest declaring nothing, a disabled plugin, and the registration init carrying resolved values
- [x] 3.3 Add an optional `identity` to `EventSink` and an optional `target` filter to `EventBus.publish`, keeping sequence increments, rate limiting, queues and failure isolation unchanged; verify `events.test.ts` delivers a targeted event to one identity, skips a subscribed frame of another identity, still increments the topic sequence, and delivers nothing when no frame matches
- [x] 3.4 Add `HandlerPool.updateSettings(identity, values)` that publishes `config/changed { pluginId, values }` with the identity target, and a test with two plugins and two subscribed handler frames proving the second frame receives neither the event nor the values; verify the test fails if the target filter is removed
- [x] 3.5 Wire the store's `onChange` to `HandlerPool.updateSettings` in the runtime and pass the store into the handler pool; verify a runtime test changes a setting with an open subscribed handler and observes exactly one `config/changed` with the full map, and a handler opened later receives the new values in `shell/init`
- [x] 3.6 Update `docs/contracts/plugin-protocol.md` (`ShellInit.settings`, both modes, empty map, no file content) and `docs/contracts/events.md` (`config/changed` producer, targeted delivery, `events:subscribe` requirement, remove the reserved/no-producer text); verify the text matches the protocol and events deltas

## 4. Settings surface

- [x] 4.1 Render a settings block for each validated manifest with configuration inside the existing Plugins section, using a checkbox for booleans, a select for enums, a text input for strings and a number input for numbers, with the key, description and current value; verify `PluginSettings.test.tsx` renders all four controls and shows nothing for a plugin without configuration or a manifest that has not loaded
- [x] 4.2 Commit boolean and enum changes immediately and string/number drafts on blur or Enter, reject invalid drafts without changing the active value, and show the declaration's validation error; verify tests cover a valid string commit, an invalid enum/number draft, and an unchanged store after an invalid edit
- [x] 4.3 Show the invalid-stored-value warning, the storage read/write warning and the "changes apply when the editor reopens" hint when the plugin lacks `events:subscribe`; verify tests assert each warning and that a read-only workspace still renders editable controls
- [x] 4.4 Add the settings layout styles to `apps/shell/src/app.css` without changing the dialog structure or focus order; verify the settings dialog tests still pass and the controls are reachable by keyboard

## 5. Fixture and documentation

- [x] 5.1 Add string, boolean and number-enum settings to `apps/shell/public/plugin-host-fixture/exo-manifest.json`, record `payload.settings` in `editor-common.js` `shell/init`, and update the recorded values when a `config/changed` event arrives; verify `fixture.test.ts` validates the manifest and asserts the declared settings
- [x] 5.2 Update `apps/shell/public/plugin-host-fixture/README.md` with the deployed checks for defaults, live change, reload persistence, workspace isolation, the no-subscription hint and an invalid stored value seeded through DevTools; verify every documented file and manifest path exists
- [x] 5.3 Update `docs/architecture.md` only where the new store would otherwise be contradicted (ownership/persistence notes); verify no section still says plugin settings are absent or reserved

## 6. Integration and deployed verification

- [x] 6.1 Run the full local gate: `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, `node apps/shell/scripts/check-bundle-budget.mjs apps/shell/dist apps/shell/budget.json`, `node apps/shell/scripts/check-dist-csp.mjs apps/shell/dist/index.html` and `node apps/shell/scripts/check-dist-elements.mjs apps/shell/dist`, and confirm every command passes
- [x] 6.2 Measure the bundle delta, confirm `apps/shell/budget.json` still passes, and record the measured gzip sizes and headroom
- [ ] 6.3 Against `https://mode777.github.io/exo-editor/`, open the fixture plugin's settings and confirm the string, boolean and enum controls render with the manifest defaults and descriptions
- [ ] 6.4 Against the deployed shell, open a `*.events.txt` handler, change `fixture.greeting`, and confirm the frame records exactly one `config/changed` with the full new values; confirm the value also appears in a newly opened handler's `shell/init`
- [ ] 6.5 Against the deployed shell, reload with the same workspace and confirm the changed value is restored in settings and `shell/init`; switch to a second workspace and confirm the defaults are used and the first workspace's value is not shown or delivered
- [ ] 6.6 Against the deployed shell, seed an invalid stored value for one setting in the `exo-plugin-settings` IndexedDB record through DevTools, reload and confirm the settings surface warns for that key while the plugin receives the default and the workspace stays usable
- [ ] 6.7 Against the deployed shell, confirm no setting change writes `exo.json`, creates a workspace file or opens a document tab, and that a plugin without `events:subscribe` receives no live `config/changed` (the isolation and subscription gates are also covered by unit tests)
- [ ] 6.8 Update `ROADMAP.md` layer 7 status and exit criteria with the deployed evidence, re-run `openspec validate --all`, and confirm the delta specs and contracts stay consistent

## Workflow follow-up

- Archive the change after the deployed evidence and the project review requirements are satisfied.
- Sync the delta specs into `openspec/specs/` and confirm `openspec validate --all` passes afterwards.
