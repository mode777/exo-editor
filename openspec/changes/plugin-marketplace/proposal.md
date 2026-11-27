# Proposal

## Why

Today the only way to discover and add a plugin is to know its exact
`exo-manifest.json` URL and paste it into the Plugins section of Settings. That
is acceptable for a workspace owner who already knows the plugin, but it makes
the deployed shell poor at the one thing a plugin ecosystem needs: letting a
user find an editor, see what it does, and add it to the current workspace
without leaving the workbench.

The shell already has the right installation primitive - a manifest URL written
to the workspace's `exo.json` - and a consent gate that no install path may
bypass. What is missing is discovery and a first-class management surface. This
change adds both without adding a backend, a package download, an account, a
signature authority or an update channel.

## What Changes

- Add a deployment-scoped marketplace source file, `marketplace-sources.json`,
  emitted next to the shell. It is fixed by whoever deploys the instance; the
  shell fetches it from its own origin and offers no UI to add, remove or
  override feeds. A deployment may list several feeds.
- Add the marketplace feed format, `marketplace.json`, inspired by the
  `marketplace.json` marketplace envelope (`name`, `owner`, `plugins[]`) but
  with an explicit `manifest` URL per plugin. The feed is discovery-only: the
  manifest remains the source of truth for identity, version and capabilities.
- Add the authoritative feed to this repository at `marketplace/marketplace.json`
  and deploy it to `https://mode777.github.io/exo-editor/marketplace.json`. It
  lists the two shipped reference plugins (Monaco code editor and template). A
  deploy script copies it and the sources file into the output and accepts a
  deployment override for the sources file.
- Add an **Extensions** activity-bar view built like the VS Code extensions
  panel: a search field, an **Installed** section and a **Marketplace** section
  with icon/title/publisher/description rows, install/manage actions, an
  "Install from URL" form, feed errors, empty and offline states, and a
  shell-owned details tab with manifest metadata, permissions, host status,
  consent actions and the plugin's contributed settings.
- Installation writes one enabled manifest entry to the current workspace's
  `exo.json` through the existing configuration store and workspace session.
  The normal host lifecycle then fetches the manifest and requests consent. A
  catalog entry cannot install silently, mount a frame or skip consent. Removing
  or disabling from the panel uses the same dirty-document guard as today.
- Move installed-plugin management out of Settings: add by URL, enable/disable,
  remove, consent review/revoke and contributed settings live in Extensions and
  its details tab. Settings keeps a debug surface: raw `exo.json` editing and
  validation issues, runtime status and the plugin log.
- Add the `exo.extensions.focus` command and View-menu entry, with the familiar
  `Ctrl+Shift+X` keybinding. Extensions works without a workspace for browsing,
  but install is disabled until a writable workspace with a valid or absent
  declaration is ready.
- Add a marketplace contract, feed/source JSON Schemas, unit and integration
  tests, author documentation, security-review control and deployed acceptance
  checks. No protocol message, shell event, SDK API, permission, capability bit
  or consent-fingerprint input changes.

**Assumptions recorded for review:** "install" means registering the plugin's
manifest URL in the current workspace, not copying plugin code; the UI label is
**Extensions** while contracts keep the domain term *plugin*; there are no
ratings, reviews, recommendations, automatic updates, telemetry or third-party
install scripts in this change; the UI opens details in a shell-owned tab to
match VS Code rather than expanding everything inside the side bar.

**Sequencing:** `surface-companion-panels` is still in progress at shell
`0.11.0`. This change lands after it and bumps the shell to `0.12.0`; the
marketplace feed schema starts at `1`. Protocol `1`, manifest schema `1` and SDK
`1.10.0` stay unchanged.

## Capabilities

### New Capabilities

- `plugin-marketplace`: deployment-scoped feed sources, the feed format and
  validation, lazy catalog loading and failure isolation, the Extensions
  activity-bar surface, installed/catalog/detail UI, and install/remove/enable
  semantics through `exo.json` and the existing host and consent path.

### Modified Capabilities

- `editor-shell`: plugin configuration management moves from Settings to the
  Extensions view and its details tab; Settings becomes the raw-configuration,
  status and log debug surface; the shell adds the Extensions activity-bar view
  and focus command.
- `plugin-settings`: contributed settings render in the extension details tab
  instead of the Settings Plugins section, with the same workspace scoping,
  validation and storage behavior.
- `plugin-manifest`: `exo.json` remains the only install registry, and the
  shell-owned plugin management surface (Extensions or the debug settings
  surface) is its writer; formatting-normalization wording follows the new
  surface.
- `plugin-authoring`: the author handoff adds a marketplace-listing page and the
  release documentation adds the independently versioned marketplace feed
  schema.

## Impact

- New `marketplace/marketplace.json`, `marketplace/sources.json`,
  `schema/marketplace.schema.json` and `docs/contracts/marketplace.md`.
- New `apps/shell/src/marketplace/` store and validators, Extensions view,
  details tab and management controller; updates to `workbench/views.tsx`,
  `workbench/config.ts`, `workbench/tabs.ts`, `document/DocumentArea.tsx`,
  `settings/`, `App.tsx`, `app.css`, commands and menus.
- New `apps/shell/scripts/copy-marketplace.mjs` (or equivalent) and
  `check:marketplace`, wired into the CI `verify` job after the plugin copies;
  deployment override via `EXO_MARKETPLACE_SOURCES`.
- Shell `apps/shell/package.json` and `SHELL_VERSION` bump to `0.12.0`, a
  changelog entry, and a re-measured bundle budget.
- Docs: architecture decision D20, vision non-goal removal, security-review
  control, accessibility script, releases version axis, author guide,
  walkthrough and README/AGENTS/ROADMAP status.
- Tests: feed/source parsing, limits and hostile input; lazy fetch, abort,
  per-feed failure and dedupe; install/remove/enable with dirty guards and
  read-only/no-workspace cases; Extensions and details accessibility; command
  and menu wiring; a removal test that fails if the consent path or `exo.json`
  write is bypassed.
- No backend, no proxy, no credentials, no new dependency, no protocol, manifest,
  SDK or consent-fingerprint change.
