# Releases

This page defines how Exo Editor versions and communicates changes. It does not
replace the contracts; the normative version rules are in
[`docs/contracts/plugin-protocol.md`](./contracts/plugin-protocol.md),
[`docs/contracts/plugin-manifest.md`](./contracts/plugin-manifest.md) and
[`docs/contracts/plugin-sdk.md`](./contracts/plugin-sdk.md).

## Version axes

| Axis | Current | Where it lives | Meaning |
| --- | --- | --- | --- |
| Shell SemVer | `0.1.0` | `apps/shell/package.json`, `SHELL_VERSION`, advertised in `shell/init` | The deployed shell release; independent of the protocol major |
| Protocol major | `1` | Envelope `exo: 1`, `PROTOCOL_VERSION`, handshake | The wire compatibility axis; the shell accepts exactly one major per release |
| Manifest schema | `1` | `manifest.schemaVersion` / `exo.json` `schemaVersion` | The manifest shape; a new version needs a validator and a consent re-prompt |
| SDK SemVer | `1.2.0` | `packages/plugin-sdk/package.json` | The client package; its MAJOR equals the protocol major it speaks |
| Artifact versions | `0.1.0` | template and code-plugin packages | Demo/reference artifacts; not a compatibility promise |

Changing one axis does not imply a change to the others. The shell version
answers "which deployed release is this"; the protocol major answers "can this
plugin talk to it"; the manifest schema answers "can this manifest be read"; the
SDK version answers "which client API is this".

## Current release

The first public release is shell `0.1.0`, protocol `1`, manifest schema `1`,
SDK `1.1.0`, dated 2026-11-16. The current SDK minor is `1.2.0`, which adds the
additive file-picker helper without changing the protocol major. "v1" in the
product documents is the first supported protocol major and release milestone,
not a claim that the shell package is on SemVer `1.x`. A shell `1.0.0` is a
separate decision governed by this plan; it is not made by the release-readiness
change.
The matching entry is in [`CHANGELOG.md`](../CHANGELOG.md).

## Release checklist

1. Confirm the change belongs to one roadmap layer and its OpenSpec change is
   complete.
2. Run the local gate from `AGENTS.md`: clean install, lint, format, typecheck,
   tests, build, bundle budget, CSP, custom elements, no-SDK, no-Monaco,
   `check:dist-secrets`, template/code builds and deploy copies.
3. Deploy `main`; confirm the CI `verify` job is green and the Pages artifact
   contains the shell plus the template and code-plugin child paths.
4. Verify the release criteria against the deployed URL, never a local dev server
   or local build: security review evidence, accessibility manual script,
   browser matrix states, performance measurements, demo workspace and
   walkthrough.
5. Refresh `docs/security-review.md`, `docs/accessibility.md`,
   `docs/browser-support.md`, `docs/performance.md` and `docs/walkthrough.md`
   with the deployed commit and date.
6. Add the changelog entry with the shell, protocol, schema and SDK versions and
   any breaking change.
7. Update `ROADMAP.md`, archive the OpenSpec change and sync its deltas into
   `openspec/specs/`; run `openspec validate --all`.
8. Do not tag or announce a release with an open finding above "accepted", an
   unmet performance budget without a written acceptance, or a stale walkthrough.

## Changelog policy

`CHANGELOG.md` is required at the repository root. The newest entry names the
date and the four version axes. Bug fixes and internal changes go under
`Changed`/`Fixed`; author-visible additions go under `Added`; removals or
reinterpretations go under `Breaking` with a link to the upgrade note. The
newest entry must match the current versions; a release test enforces it.

## Deprecation

When an SDK API is deprecated:

1. Mark it `@deprecated` in the package with the replacement.
2. Add a `Deprecated` entry to `CHANGELOG.md` naming the replacement and the
   first major that may remove it.
3. Document it in the author guide or its linked contract.
4. Keep it functional for the rest of the current major; remove it only at the
   next major.

Wire messages and manifest fields are not deprecated in place: removing or
reinterpreting one is a breaking change below.

## Breaking changes

A change that removes or reinterprets a wire field, an envelope rule, a message
or a manifest field requires:

- a new protocol major and a new SDK major (the SDK MAJOR equals the protocol
  major);
- a new `schemaVersion` if the manifest changes;
- a written upgrade note linked from the changelog and the author guide,
  describing what breaks and how to migrate;
- a shell release that does not silently accept the old major;
- a new consent fingerprint when the capability surface changes, so users are
  asked again.

The protocol contract's versioning section remains the normative source for the
wire rules.

## Current scope

The SDK is not published to a registry in v1 (D12). The template and code plugin
are private workspace artifacts. A published package is a future change with its
own release plan; it must not be inferred from the versions above.
