# Tasks

## 1. Review the contracts

- [ ] 1.1 Review `docs/contracts/workspace-api.md` against the roadmap's layer 2 and 4 needs: confirm the provider surface covers the explorer (list, stat, create, rename, delete), the document renderer (read, write, version), restore and teardown. Record any missing operation as a contract change, not as a shell helper.
- [ ] 1.2 Review `docs/contracts/plugin-manifest.md`: confirm every field the consent UI must display is present, that the fingerprint inputs are exactly the fields that change behaviour, and that `exo.json` rules can be implemented without a JSON parser beyond `JSON.parse`. Resolve whether `contributes.configuration` stays rejected until layer 7.
- [ ] 1.3 Review `docs/contracts/plugin-protocol.md` as a pair with a stub plugin, message by message: handshake, `shell/init` (including the editor file block), register, register-complete, request-file, file-content, dirty, request-save, save-content, save-result, file-changed, dispose, dispose-ack. Confirm no state transition is missing and no message requires the shell to parse editor content.
- [ ] 1.4 Review `docs/contracts/events.md`: confirm the four v1 topics cover theme, file, workspace and configuration needs; confirm that handler-frame-only subscriptions are acceptable for the reference plugin; settle the three open questions recorded in section 8.
- [ ] 1.5 Review the decisions table in `docs/architecture.md`: confirm D5 (first-party plugins may share the shell origin with the stricter sandbox), close D12 (SDK/repo split), confirm D7 (what survives a workspace switch) and D11 (plugin settings storage), and verify D9 covers both sandbox cases.

## 2. Ratify

- [ ] 2.1 Align the contract documents with the five delta specs in this change: every requirement has a matching normative statement, and no document promises behaviour the spec does not require or forbids behaviour the spec allows.
- [ ] 2.2 Add the shared JSON Schema for `exo.json` and `exo-manifest.json` at the path both the validator and the documents will reference, and link it from the manifest contract and the README.
- [ ] 2.3 Update `README.md` and `ROADMAP.md` status wording from "draft" to "ratified" for the five capabilities, and mark layer 0 complete with its exit criteria.
- [ ] 2.4 Run `openspec validate --all` and `openspec validate define-core-contracts`; fix every finding before archiving.

## 3. Unblock the next layers

- [ ] 3.1 Confirm layer 2 can start: the workspace contract needs no further decision, and the memory provider is specified well enough to serve as the test oracle.
- [ ] 3.2 Confirm layer 4 can start: manifest validation, consent storage, plugin-root containment and registration framing have no unresolved inputs, and the same-origin sandbox case is specified.
- [ ] 3.3 Archive this change with `openspec archive define-core-contracts`, verify `openspec/specs/{editor-shell,workspace-access,plugin-manifest,plugin-protocol,plugin-events}/spec.md` exist, and re-run `openspec validate --all`.
