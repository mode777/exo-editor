# Changelog

All notable changes to Exo Editor are recorded here. The version axes and the
release process are in [`docs/releases.md`](./docs/releases.md).

## [0.1.0] - 2026-11-16

First public v1 release. The shell is deployed at
`https://mode777.github.io/exo-editor/`; editors are untrusted sandboxed plugins.

### Added

- The static workbench shell, workspace providers (folder and Stratofold
  remote), consent, plugin host, file handlers, events and plugin settings.
- `@exo/plugin-sdk` (private), the starter template and the Monaco reference
  code plugin, deployed as child paths of the shell site.
- The release evidence and author handoff: security review, accessibility,
  browser matrix, performance budgets, plugin author guide, demo workspace and
  walkthrough.

### Compatibility

- Shell: `0.1.0`
- Protocol: `1`
- Manifest schema: `1`
- SDK: `1.1.0`

### Breaking

- None. This is the first release of protocol major `1`.
