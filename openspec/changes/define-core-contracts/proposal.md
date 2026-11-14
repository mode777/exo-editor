# Proposal

## Why

Exo Editor's expensive mistakes are all contract mistakes. The shell hands file
access to untrusted code, loads that code from other origins, and has to keep the
two isolated across workspace switches. Once a provider method, a manifest field
or a message shape is in use, changing it means touching the shell, the plugin
SDK, the reference editor and every third-party plugin at once.

The repository currently contains drafts of those contracts in
[`docs/contracts/`](../../../docs/contracts/), the surrounding architecture and a
layered roadmap, but nothing has been ratified. Layer 1 (`scaffold-shell-app`)
can start without them; every later layer depends on them. This change turns the
drafts into normative OpenSpec capabilities and closes the decisions that would
otherwise be settled by accident in code.

## What Changes

- Adopt five capabilities as the v1 contract surface:
  `editor-shell`, `workspace-access`, `plugin-manifest`, `plugin-protocol` and
  `plugin-events`.
- Ratify the workspace provider and session contract: mediated access only,
  normalization and containment, reserved paths, versioned writes, capability
  declaration, handle persistence and deterministic teardown.
- Ratify the manifest contract, including `exo.json`, declared file-editor
  entries (glob plus relative HTML page), the capability fingerprint, consent
  storage, the plugin-root confinement rule, and the sandbox chosen by origin
  relationship.
- Ratify the protocol: envelope, handshake, registration phase, handler sessions
  with read-on-demand, dirty/save/conflict handling, disposal, timeouts and
  limits.
- Ratify the event topics, payloads, ordering, coalescing and overflow behavior.
- Record the shell-level invariants (static hosting, composition over forking,
  shell-only `exo.json`, no privileged editor) so later changes can reference
  them.
- Tighten the documents so the prose and the requirement text agree, and add a
  JSON Schema for both files that the validator and the docs will share.

Not included: any runtime code, the shell scaffold, a plugin host, schema
validation implementation, a published SDK or the Monaco plugin. Those are later
roadmap layers.

## Capabilities

### New Capabilities

- `editor-shell`: the static, backend-free shell, its reuse of the workbench kit,
  its ownership of the workspace and plugin surfaces, and the invariant that no
  editor is privileged.
- `workspace-access`: the provider and session contract that mediates all file
  access, including paths, errors, versioned writes and workspace reset.
- `plugin-manifest`: `exo.json`, `exo-manifest.json`, entry resolution,
  validation, consent and the capability fingerprint.
- `plugin-protocol`: the `postMessage` envelope, handshake, registration and file
  handler sessions, save flow and limits.
- `plugin-events`: the topic subscription API, its v1 catalog and delivery
  guarantees.

### Modified Capabilities

None. This is the first contract set in the repository.

## Impact

- New: `openspec/changes/define-core-contracts/specs/*` (five delta specs) and
  the change's `.openspec.yaml`.
- Changed: [`docs/contracts/*`](../../../docs/contracts/), the decisions table in
  [`docs/architecture.md`](../../../docs/architecture.md), [`ROADMAP.md`](../../../ROADMAP.md)
  status and [`README.md`](../../../README.md) status wording.
- Unchanged: no application code, no dependencies, no build, no deployment.
- Compatibility: no consumer exists yet, so there is nothing to migrate. Once
  ratified, a contract change requires a new OpenSpec change that updates the
  spec and the contract document together.
