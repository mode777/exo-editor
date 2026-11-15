# Tasks

## 1. Contracts and shared protocol plumbing

- [x] 1.1 Update `docs/contracts/plugin-protocol.md` with the editor eligibility rule (`workspace:read` or `workspace:write`), the save rule (`workspace:write` plus a writable session, otherwise `permission-denied` with no write), and the read-only editor outcome; verify the text matches the `plugin-protocol` delta requirement and its scenarios
- [x] 1.2 Update the permission rules in `docs/contracts/plugin-manifest.md` so a file-editor contribution needs `workspace:read` and write implies read, and confirm the shared schema still validates
- [x] 1.3 Extract envelope parsing, message-size checking, target-origin selection and the violation counter from `RegistrationSession` into `apps/shell/src/plugins/protocol.ts`; verify `npm test -- src/plugins/registration.test.ts` stays green with no behavior change
- [x] 1.4 Carry `pluginName`, `permissions` and `entryUrl` on `EditorCandidate` from the validated manifest through the registry, and verify a registry test asserts the new fields and existing ordering
- [x] 1.5 Reject file-editor contributions from plugins without read permission with `permission-denied` at registration, and verify a registration test covers the rejection plus the `workspace:write`-implies-read case

## 2. Handler session

- [x] 2.1 Implement the handler state machine (mount URL with `exo-host`/`exo-mode=editor`/`exo-session`, `plugin/ready` verification, metadata-only `shell/init`, ready timeout) in `apps/shell/src/plugins/handler.ts`; verify with a fake transport test that init contains no content and an unready frame times out
- [x] 2.2 Implement `plugin/request-file` resolution: relative to the handler file's directory, `/` absolute, `normalizePath` rejection mapped to `permission-denied`, containment, reserved-path denial through `session.forPlugin`, `workspace:read` check and `maxRequestBytes`; verify tests for each rejection plus a successful relative read
- [x] 2.3 Add the per-session content cache keyed by path and version with invalidation on external change, and verify a test serves a repeated read from cache and re-stats after a change notification
- [x] 2.4 Implement dirty and save dispatch: `plugin/dirty` callback, one live `shell/request-save` plus one queued, `plugin/save-content` accepted only with a matching live `replyTo`, 5 s timeout, and unsolicited content treated as a violation; verify with fake-transport tests for each path
- [x] 2.5 Implement `shell/dispose` handling with the 1 s acknowledgement window, idempotent close and dropping all messages after disposal; verify a test asserts no late read or save is processed
- [x] 2.6 Add per-identity frame accounting and the 20-frame cap in the handler pool, and verify a test mounts 20 frames, refuses the 21st and reports the cap outcome
- [x] 2.7 Add a security regression test that fails when the origin/source check or the reserved-path check is removed from the handler path, and verify it fails against a deliberately disabled check before restoring it

## 3. Document integration

- [x] 3.1 Add `surface` and `editor` state to `DocumentState` and route `open()` through the handler pool before any content read; verify a test asserts no `session.read` call for a plugin-backed document and the existing text path is unchanged when no candidate matches
- [x] 3.2 Wire plugin dirty reports to the tab dot, `hasDirty()`, the unload warning and the close prompt through the existing `onDirtyChange` path; verify a store test and an App test cover a dirty plugin document prompting on close
- [x] 3.3 Route `DocumentStore.save()` to a handler round trip with the last delivered version as `ifVersion`, clear dirty only when no newer report arrived, and keep the tab dirty on `conflict`, `timeout`, `permission-denied` and `not-found`; verify store tests for each outcome
- [x] 3.4 Forward external changes to the open handler without auto-reloading, re-key the session and tab on rename, and fail saves after deletion without recreating the file; verify store tests for changed, renamed and deleted
- [x] 3.5 Implement clean-document remount on reload and "Open with..." selection that disposes the current handler and mounts the chosen candidate for that tab only; verify a test shows another tab keeps the highest-priority editor
- [x] 3.6 Dispose handlers on tab close, plugin disable/remove/revoke, workspace switch and handler failure, cancelling in-flight saves and releasing the session only after disposal; verify tests assert dispose reasons, ordering and no write reaching either workspace on switch
- [x] 3.7 Guard plugin disable/remove/revoke with the existing Save/Discard/Cancel prompt when the plugin has dirty documents, and verify a settings test keeps the plugin intact on cancel and on a failed save
- [x] 3.8 Render the document-area states for a plugin-backed document (read-only editor with no Save, frame failure, frame cap, external change and deleted file) and verify with component tests that no empty buffer is presented as saved content
- [x] 3.9 Show a read-only workspace's plugin editors without a Save action and with an explicit notice, and verify with a component test on a non-writable snapshot

## 4. Plugin host integration

- [x] 4.1 Add the handler-lifecycle seam to `PluginHost` and close handlers for an identity in `stopRecord` before dropping its registry entry; verify a host test disables a plugin and asserts `closeFor` ran and the registry lost the candidates
- [x] 4.2 Log handler phases (open, read denial, save result, dispose, failure) with plugin id, path, phase and code but no content, and verify a host test asserts the entries and the cap of 200
- [x] 4.3 Verify `plugin/subscribe` and `plugin/unsubscribe` in editor mode receive `unsupported-message` without a violation count in this layer, and record that layer 6 replaces the behavior

## 5. Fixture and documentation

- [x] 5.1 Turn `apps/shell/public/plugin-host-fixture/editor.html` into a real handler that reads, reports dirty, saves modified text and acknowledges dispose, with behavior selected by the opened path and state mirrored into `document.title` and `#observation`
- [x] 5.2 Add fixture variants for repeated reads, a never-ack dispose and a save that appends a marker, and update the fixture manifest and README so each variant is reachable
- [x] 5.3 Update the plugin fixture section of `AGENTS.md` and `apps/shell/public/plugin-host-fixture/README.md` with the new editor behavior and manual checks, and verify the documented files exist

## 6. Integration and deployed verification

- [x] 6.1 Run the full local gate (`npm ci`, `lint`, `format:check`, `typecheck`, `test`, `build`, bundle budget, dist CSP, dist elements) and confirm every command passes
- [x] 6.2 Measure the bundle delta, verify `npm run budget` passes and record the measured number with any deliberate limit change
- [x] 6.3 Against `https://mode777.github.io/exo-editor/`, open a `.txt` file with a plugin editor registered and confirm one handler frame mounts and no content is requested until the handler asks; record the observation
- [x] 6.4 Against the deployed shell, edit through the plugin, confirm the tab dot, close prompt, save round trip and exact saved bytes, and record the observed content
- [x] 6.5 Against the deployed shell, change the open file on disk and confirm the handler is notified, the tab shows the external-change notice and a save surfaces `conflict` without overwriting; record the steps and result
- [x] 6.6 Against the deployed shell, close the tab and confirm the frame is gone and no further messages are accepted; disable the plugin and confirm the file falls back to the shell text renderer
- [x] 6.7 Against the deployed shell, confirm a read-only viewer workspace opens plugin editors without Save, and a plugin without `workspace:write` behaves the same; record both
- [x] 6.8 Update `ROADMAP.md` layer 5 status and exit criteria with the deployed evidence, and confirm `openspec validate --all` passes

## Workflow follow-up

- Archive the change after the deployed evidence and the project review requirements are satisfied.
- Sync the delta specs into `openspec/specs/` and confirm `openspec validate --all` passes afterwards.
