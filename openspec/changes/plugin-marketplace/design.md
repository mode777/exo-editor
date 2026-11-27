# Design

## Context

See [`proposal.md`](./proposal.md) for motivation and the spec deltas for
required behavior. The current shell already has the pieces this change builds
on:

- `PluginConfigStore` reads and canonically rewrites `/exo.json` through the
  workspace session, with `ifVersion` writes, duplicate detection and
  all-or-nothing validation.
- `PluginHost` consumes that store, loads and validates each manifest, requests
  consent, and only then mounts frames. A live `exo.json` add already follows
  this path.
- `ExtensionsView` does not exist; the primary view registry contains only
  `explorer`, and `SettingsDialog` contains the Theme, Workspace and Plugins
  sections, including raw `exo.json`, installed entries, add-by-URL, consent
  review/revoke, contributed settings and the plugin log.
- The shell composes `vscode-workbench` through public `config` and `views`
  props. A primary view is a React component; the view header is shell chrome
  supplied from a `ViewDefinition`, and the document area renders shell-owned
  content through `renderDocument`.
- `marketplace-sources.json` and `marketplace.json` do not exist. The CI
  `verify` job builds the shell, runs the shell-only budget, builds and copies
  the template and code plugin, then scans the artifact for secrets.
- `surface-companion-panels` is still in progress at shell `0.11.0`. This
  change lands after it and targets shell `0.12.0`. Protocol `1`, manifest
  schema `1`, SDK `1.10.0` and the consent fingerprint stay unchanged.

The deployed CSP already allows `connect-src https:` and has no `img-src`
directive, so HTTPS feed and icon requests work without a policy change. There
is no backend, no proxy and no place to keep a secret.

## Goals / Non-Goals

**Goals:**

- A fixed, deployment-scoped source list that a static host can change by
  replacing one file in the deployed artifact, with no application rebuild.
- A strict, small feed format that is friendly to maintain by hand and can be
  generated from manifests, while keeping the manifest as the only authority for
  identity, version and capabilities.
- A VS Code-shaped Extensions experience: search, Installed, Marketplace,
  install/manage actions, and a details tab with settings.
- One management path for install, enable, disable, remove and consent, used by
  both the new panel and the retained debug surface.
- A testable security boundary around hostile feed data and a deployed official
  feed that is validated in CI.

**Non-Goals:**

- Ratings, reviews, recommendations, download counts, telemetry or accounts.
- Automatic updates, version pinning, rollback, signatures or package
  verification.
- Installing plugin code into the workspace or serving it from the shell.
- A feed-management UI, feed authentication, private feeds or per-workspace
  feeds.
- Remote search, server-side ranking or pagination beyond the entry cap.
- A second details surface inside the side bar; details open as a shell tab.
- Any protocol, SDK, manifest, permission or consent-fingerprint change.

## Decisions

### D1 - Two documents: the feed and the deployment source list

Use two independent JSON documents:

- `marketplace.json` is the public feed. It describes one marketplace, its
  owner and its plugin entries. It may live on any HTTPS origin.
- `marketplace-sources.json` is the deployment configuration. It lists the feed
  URLs this shell instance reads. It is served from the shell origin and is the
  only discovery source list the shell accepts.

The repository stores the authoritative feed at
`marketplace/marketplace.json` and the default deployment list at
`marketplace/sources.json`. The deploy step copies them to
`dist/marketplace.json` and `dist/marketplace-sources.json`. An operator can
replace the source file in the artifact, or set `EXO_MARKETPLACE_SOURCES` for
the copy script, without editing application code. The feed can be overridden
with `EXO_MARKETPLACE_FEED` for a different instance.

The shell resolves `marketplace-sources.json` against `document.baseURI`, so a
fork that changes `EXO_BASE_PATH` still finds its own file. Feed URLs are
absolute, like manifest URLs, so a stale source file fails visibly instead of
silently resolving against the wrong origin.

For local development only, a Vite middleware serves the two files from the
top-level `marketplace/` directory. It is not part of the production build and
does not weaken the deploy-time guarantee; `npm run dev` gets a working catalog,
while the built artifact still receives the files only from the deploy step.

Alternatives rejected:

- **One file containing both the feed list and the plugins.** Per-instance
  configuration and a public feed have different owners, lifetimes and cache
  policies. Combining them forces an instance to republish the whole catalog to
  change its sources.
- **Feed URLs in `exo.json`.** A workspace could then re-point discovery, which
  conflicts with "fixed for each deployed instance" and puts a network-policy
  decision in a workspace file.
- **Hard-code one feed URL in the bundle.** Forks and private deployments could
  not change it without a build, and the requirement explicitly asks for
  deploy-time configuration.
- **`localStorage` or a settings UI.** That makes the list user-scoped rather
  than instance-scoped and adds a way for hostile content to persist.

### D2 - A marketplace envelope inspired by marketplace.json, with `manifest` as the source

The feed keeps the familiar envelope:

```json
{
  "schemaVersion": 1,
  "id": "exo-official",
  "name": "Exo Plugins",
  "description": "Plugins published by the Exo Editor project.",
  "owner": { "name": "Exo Editor", "url": "https://github.com/mode777/exo-editor" },
  "plugins": [
    {
      "name": "Exo Code",
      "manifest": "https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json",
      "description": "Monaco-based reference code editor built with @exo/plugin-sdk.",
      "version": "0.1.0",
      "publisher": { "name": "Exo" },
      "homepage": "https://github.com/mode777/exo-editor",
      "license": "MIT",
      "keywords": ["code", "editor"],
      "category": "Editors"
    }
  ]
}
```

The envelope uses `id`, `name`, `owner` and `plugins` like the
`marketplace.json` pattern. The entry deliberately uses `manifest` rather than
the standard's polymorphic `source`: an Exo plugin is always one manifest URL,
and naming it explicitly prevents a market from implying a package, git or local
source type the shell cannot install.

The feed does not declare permissions, engines, publishers' identities or
capabilities. Those are untrusted claims for display only. The fetched manifest
remains authoritative for identity, version, engine compatibility, permissions
and consent. Feed display metadata may be stale; once a manifest loads, every
installed, consent and detail surface uses the manifest.

Unknown fields are rejected at every level, matching the manifest and `exo.json`
posture. A feed is validated all-or-nothing per feed: one bad entry rejects that
feed, while other configured feeds stay usable. This avoids silently accepting a
partial catalog whose rows may be out of sync with its envelope.

Limits are fixed in the contract and mirrored in `schema/marketplace.schema.json`:
source file 64 KiB and 10 feeds; feed 512 KiB and 500 plugins; 10-second
timeout; 1-80 character names/owner; 500-character descriptions; 10 keywords of
at most 32 characters; HTTPS (or localhost) URLs with no credentials or
fragment; unique normalized manifest URLs within a feed.

### D3 - One schema file, one shell parser, a parity test and a small deploy validator

`schema/marketplace.schema.json` contains `$defs` for `marketplaceSources` and
`marketplaceFeed` and a top-level `oneOf`, like `schema/exo.schema.json`. The
shell parser in `apps/shell/src/marketplace/feed.ts` mirrors the constants and
semantic rules; a parity test reads the schema and pins every constant, so the
two cannot drift.

The deploy scripts are `.mjs` and cannot import TypeScript directly under the
supported Node 20 floor. The repository test suite validates the official feed
and default source file with the real shell parser (vitest reads the files), and
`scripts/check-marketplace.mjs` performs a small structural check on the built
artifact: files exist, parse, use `schemaVersion: 1`, have bounded entry counts,
unique HTTPS manifest URLs and the expected official manifest URLs. The deploy
script runs the same check before copying. This keeps the runtime validator
authoritative without adding a JSON Schema dependency or a second full
implementation.

Alternative rejected: generate a JSON Schema validator at build time. It adds a
dependency and a second validation semantics for a format that is intentionally
small.

### D4 - `MarketplaceStore` is deployment-scoped, lazy and in-memory

Add `MarketplaceStore` next to the other stores on `WorkspaceRuntime`:

```ts
interface MarketplaceSnapshot {
  phase: 'idle' | 'loading' | 'ready'
  feeds: MarketplaceFeedSnapshot[]
  plugins: MarketplacePlugin[]
  revision: number
}

interface MarketplaceFeedSnapshot {
  url: string
  status: 'loading' | 'ready' | 'failed'
  feed?: MarketplaceFeed
  issues?: MarketplaceIssue[]
}
```

- The store is created once with the runtime and is not reset on a workspace
  switch. Feeds belong to the deployment, not the workspace.
- `ensureLoaded()` fetches the source file and then all feeds on the first
  Extensions mount. The view calls it from an effect; no startup request is
  made for users who never open Extensions.
- `refresh()` clears the in-flight generation and fetches again. Late results
  from an older generation or after `dispose()` are inert.
- The store uses injectable `fetch`, `setTimeout` and a source URL so tests can
  avoid the network and the deployed origin.
- All fetches use `credentials: 'omit'` and `cache: 'no-cache'`; the response
  body is read with a byte cap rather than trusting `Content-Length`. Each feed
  gets an `AbortController` and a 10-second timeout.
- Feeds load concurrently with the configured maximum, and a rejected feed is
  recorded only on its own snapshot entry. Catalog rows are flattened in source
  order, then feed entry order, and deduped by normalized manifest URL; the
  first feed wins.
- The catalog is never written to IndexedDB, `localStorage`, `exo.json` or a
  URL. A refresh is the only way to update it.

Alternatives rejected:

- **Fetch at startup.** Wastes a request for most sessions and puts third-party
  discovery traffic on the critical path.
- **Persist the catalog.** Creates stale metadata, a privacy footprint and a
  second source of truth for installed state.
- **Fetch each manifest while cataloging.** That multiplies requests, hits CORS
  before the user cares and still cannot guarantee freshness. Install writes the
  URL; the host does the one authoritative fetch.
- **Reset the catalog on workspace switch.** It is not workspace-scoped and
  would produce a visible reload for no behavioral benefit.

### D5 - Installation stays a workspace write, followed by the normal host path

Installation is not a package install. It calls the existing
`PluginConfigStore.addEntry(manifestUrl)`, which validates the URL, rejects a
duplicate after canonicalization, writes through the session with the loaded
`ifVersion` and lets the host reconcile the new enabled entry. No marketplace
code calls `PluginHost` directly to start a frame, and no feed metadata enters
`exo.json`.

Add a `PluginManagementController` (owned by the runtime) for the UI operations
that need the dirty-document guard and cross-store coordination:

```ts
install(manifestUrl): Promise<PluginConfigMutationResult>
setEnabled(manifestUrl, enabled): Promise<PluginConfigMutationResult>
remove(manifestUrl): Promise<PluginConfigMutationResult>
requestConsent(identity): void
revokeConsent(identity): void
// pending dirty action: save / discard / cancel
```

The controller:

- resolves an installed entry by normalized manifest URL, not array index, so a
  concurrent external change cannot toggle the wrong row;
- awaits the config store's in-flight load before mutating;
- runs `documents.dirtyPathsFor(identity)` before disable/remove/revoke and
  exposes the same save/discard/cancel prompt used by Settings today;
- returns the existing `PluginConfigIssue[]` so Extensions and the debug surface
  show one error vocabulary;
- never preflights a manifest. A preflight would duplicate the host's fetch,
  race a changing manifest and create a second validation path. If the installed
  URL is broken, the row shows the host's failure and stays removable.

The existing Settings implementation is refactored onto this controller rather
than kept as a parallel path.

### D6 - The Extensions view is a built-in primary view, not a plugin

Register `extensions` in `workbenchViews.primary` and add it to
`workbenchConfig` after Explorer:

```ts
activityBar: { items: [explorer, extensions], bottomItems: [settings] }
primarySideBar: { views: ['explorer', 'extensions'] }
```

`derivePluginWorkbench` still appends plugin primary views after the core views,
so declaration order remains deterministic. The view definition gets a
`refresh` action; the install-by-URL form and the details button live in the
component because they are local UI state, not global commands.

The component uses the existing tokens and follows the VS Code extension view:

- one labelled search field filters both sections locally;
- **Installed** is a collapsible section with a count and one row per
  `exo.json` entry, merged with the host record by manifest URL;
- **Marketplace** is a collapsible section with one row per deduped catalog
  entry, in feed order, with a source label;
- each row is a two-line title/publisher/description block, an optional icon,
  and one install/manage action; no nested interactive elements;
- status text uses the host phases (`Disabled`, `Loading manifest…`,
  `Awaiting consent`, `Denied`, `Registering…`, `Active`, `Failed`) and a
  failed row exposes the code and phase;
- feed loading, source loading, per-feed errors, empty search, no feeds, offline
  and no-workspace states are explicit;
- Refresh re-runs `MarketplaceStore.refresh()`;
- the form validates the same URL pattern as `exo.json` before submitting and
  reports the store's issues inline.

The view works with no workspace: catalog and details are available, install
and manage are disabled with a single explanation. In a read-only workspace,
settings in details remain editable but install/manage/remove and raw save do
not.

**Naming:** the UI says **Extensions** because that is the surface the user
asked for and the VS Code reference; contracts continue to say *plugin* for the
protocol and manifest domain. The command is `exo.extensions.focus`, bound to
`Ctrl+Shift+X`, and appears in the View menu and palette.

### D7 - Details open in a shell-owned tab

The closest VS Code behavior is a details page in the editor area. Add a
shell-owned tab kind to the existing tab metadata:

```ts
interface ShellViewTabInfo {
  kind: 'extension'
  manifestUrl: string
}

function shellViewOf(tab: WorkbenchTab): ShellViewTabInfo | undefined
function openShellViewTab(info: ShellViewTabInfo): void
```

`DocumentArea` checks `shellViewOf` before `contentViewOf` and renders
`ExtensionDetails`. The tab uses the kit's content kind, opens/focuses by stable
id `shell:extension:<normalized manifest URL>`, has no dirty state, closes
without a prompt, and is cleared by the existing workspace-switch tab reset.
`runtime.setActiveTab` already clears the active content/editor when the tab is
not a file or plugin content view, so companions and the active editor payload
are unaffected.

The details tab shows:

- icon, name, publisher, version, description and source feed;
- manifest URL and origin;
- install, enable/disable and remove actions with the same disabled rules;
- status, failure code/phase and review/revoke;
- permissions in plain language and declared contributions;
- contributed settings, reusing the extracted typed controls from the current
  Settings component;
- homepage/license links opened with `rel="noopener noreferrer"`.

Feed display fields are rendered as text. No field is ever passed to
`dangerouslySetInnerHTML`, an iframe `src`, a `javascript:` URL or a shell
command.

Alternative rejected: a side-bar accordion. It is simpler but does not match
VS Code, and it would make the settings form cramped in a 200-480px side bar.

### D8 - Settings becomes the plugin debug surface

`SettingsDialog` keeps Theme and Workspace, and renames its plugin section to
**Plugin debugging**:

- raw `exo.json` editor, validation before save, `ifVersion` conflict handling
  and the canonical-format warning stay;
- every issue is shown with code, entry and field;
- a read-only host status table shows phase, identity, origin, granted
  capabilities and failure code/phase;
- the workspace-scoped plugin log stays, with command results and no content.

Removed from Settings: the add-by-URL form, install/enable/disable/remove
actions, consent review/revoke and contributed settings. A short line points to
Extensions for management. `exo.plugins.open` is retitled **Open Plugin
Debugging** (same id, no new command), and a new `exo.extensions.focus` command
opens the view.

The raw editor remains a writer of `exo.json`, alongside the Extensions
management path. Both use the same store. This is intentional recovery tooling,
not a second configuration model.

### D9 - The official feed and deploy pipeline

`marketplace/marketplace.json` lists the two deployed reference plugins:

- **Exo Code** at
  `https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json`;
- **Plugin Template** at
  `https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json`.

The feed's display metadata is kept in sync with each manifest's `id`, `name`,
`version` and `publisher` by a repository test that reads both. The test does
not fetch the deployed URLs; the acceptance walkthrough checks the deployed
manifest URLs.

`marketplace/sources.json` contains one source and no display fields:

```json
{
  "schemaVersion": 1,
  "feeds": ["https://mode777.github.io/exo-editor/marketplace.json"]
}
```

The absolute URL is deliberate: a source file copied into a fork must declare
the fork's feed URL, and a stale production URL should fail loudly rather than
silently resolving to a fork-local file. Duplicate normalized feed URLs are
rejected, like duplicate manifest URLs in `exo.json`.

`scripts/deploy-marketplace.mjs`:

1. resolves the sources path from `EXO_MARKETPLACE_SOURCES` or the committed
   default and the feed path from `EXO_MARKETPLACE_FEED` or the committed
   default;
2. parses and runs the structural checks;
3. copies to `dist/marketplace-sources.json` and `dist/marketplace.json`;
4. fails without partial output on any error.

CI runs it after the template/code copies and after the shell bundle budget,
then runs `check:marketplace`. The secret scan runs last over the full artifact.
This keeps the budget measuring only the shell and the official feed available
at a stable, discoverable URL.

Alternative rejected: put the feed in `apps/shell/public/`. Vite would copy it
before the budget and the deploy override would be a build-time concern rather
than an explicit deploy step. The top-level `marketplace/` directory also makes
the feed discoverable to non-shell contributors.

### D10 - Merging installed and catalog data

Installed rows come from `PluginConfigStore.entries`, not the catalog. The merge
key is `normalizeManifestUrl(entry.manifest)`; the host record lookup uses the
same normalized URL. The catalog contributes display metadata only when a
manifest record is not available.

The catalog is keyed by normalized manifest URL and includes the source feed.
A feed entry that points at an installed URL is not shown twice. A plugin
installed from a URL that no feed lists appears only in Installed. A plugin
listed by two feeds appears once, from the earlier source. Removing or
disabling an installed entry affects all matching catalog rows immediately
because they read the same config snapshot.

Sorting is deterministic: install order for Installed (declaration order) and
source order then entry order for Marketplace. Search lowercases and matches
name, publisher, description and keywords; it does not reorder results.

### D11 - Trust boundary and residual risks

- **Feed data is untrusted.** It is parsed as JSON, bounded, validated and
  rendered as text/links. It never becomes code, HTML, a protocol message, a
  manifest, a permission or a consent fingerprint input.
- **Feed source list is deployment-trusted.** A deployer who lists a hostile
  feed grants it catalog space but not installation or capability authority.
  The official source list contains no credentials and is fetched with
  `credentials: 'omit'`.
- **Manifest authority.** The consent dialog continues to show manifest
  metadata, origin, root, globs, permissions and rendering. A malicious feed
  cannot make a plugin look safer than its manifest unless the user is misled by
  display text; the details tab labels manifest values and the consent dialog
  never uses feed values.
- **Icons are third-party requests.** Render them with
  `referrerPolicy="no-referrer"`, `crossOrigin="anonymous"` and `loading="lazy"`,
  and fall back to a Codicon on failure. A feed operator can still learn that a
  catalog was opened if the icon host is theirs; that is the same exposure as
  opening the feed itself. No icon is required for installation.
- **No auto-update.** A feed can point at a newer manifest, but the shell only
  reads the manifest when the host loads the installed entry; it does not
  install or update anything. The user sees consent re-prompt when the
  capability fingerprint changes.
- **Homograph/typosquatting.** Feed names are display-only. Details and consent
  always show the manifest origin and id, and the manifest URL is visible. The
  review records the residual impersonation risk as accepted for a
  discovery-only catalog.
- **CSP.** `connect-src https:` already permits feeds; no `script-src` or frame
  policy changes. `img-src` is unrestricted today, so icons work without a
  policy change; the no-referrer/no-credential attributes are the mitigation.

### D12 - Accessibility and interaction

- Section headings are real headings; counts are in the accessible name.
- Collapse controls are buttons with `aria-expanded`.
- Rows use a title/details button plus sibling actions, never nested buttons.
- Search has a visible label, a result-count live region and an Escape-to-clear
  behavior.
- Loading uses `role="status"`; errors use `role="alert"`; install results are
  announced without moving focus.
- Icons are `aria-hidden` with adjacent text; icon-only refresh has an
  accessible label.
- Focus remains on the row/action after install; opening details moves focus to
  the details heading and closing restores focus to the row when possible.
- Details uses headings, definition lists and native inputs; no focus trap.
- Automated axe scans cover the view, a failed feed, no workspace, installed
  rows and details.

### D13 - Testing strategy

- **Parser:** valid examples, every limit, unknown fields, future version,
  invalid/duplicate URLs, duplicate manifest, hostile strings, empty feed.
- **Store:** lazy fetch, source failure, per-feed failure, timeout, size cap,
  CORS/network classification, dedupe, order, refresh, dispose, no frames and
  no workspace calls. Fake `fetch` records every URL.
- **Management:** install writes one entry; first install creates the file;
  duplicate/invalid/read-only/invalid-config/no-workspace blocked; enable,
  disable, remove and revoke map by URL; dirty prompt save/discard/cancel; a
  workspace switch cannot apply a pending action to the new workspace.
- **Consent invariant:** after install, the manifest is fetched through the host
  but no iframe is mounted until approval; a test fails if the marketplace path
  mounts a frame or skips the consent store.
- **UI:** search/sections/rows, feed error, no feeds, no workspace,
  install/manage disabled explanations, details metadata/permissions/settings,
  status changes, command/menu wiring, axe scans. Settings tests move to the
  debug surface and assert the management controls are gone.
- **Deployment:** official feed validates, matches both source manifests, the
  source file points to the official feed, the copy script honors overrides and
  leaves no partial file, and the built artifact contains both files.
- **Security mutation:** remove the install-disabled check for a read-only
  workspace, remove the feed dedupe, and bypass the consent gate in a test
  harness; the named tests must fail. Record the marketplace control in
  `docs/security-review.md` with enforcement and regression tests.
- **Budget:** re-measure the shell bundle and raise the committed limit only
  with the measured number and rationale; the marketplace assets are not part of
  the shell budget because they are copied after the budget check.

### D14 - Versioning, migration and rollback

- Shell `0.12.0`. Marketplace feed schema `1`. Protocol `1`, manifest schema
  `1`, SDK `1.10.0`.
- `exo.json` shape is unchanged, so no workspace migration is needed. Existing
  installed entries remain valid. The old Settings management controls are
  removed, not migrated to a new data model.
- No storage migration. The catalog is in memory; installed state remains the
  workspace file; plugin settings remain shell storage.
- Rollback is safe: remove the marketplace files and UI, keep the debug
  surface, and existing `exo.json` entries continue to load. Plugins installed
  from a catalog are ordinary manifest entries, so rollback does not strand
  them.
- A manifest listed by a feed still has to satisfy `engines.exo`; the host
  reports `incompatible-engine` after install instead of the catalog pretending
  compatibility. The details tab shows that failure and the remove action.

## Risks / Trade-offs

- **[Feed metadata drifts from manifests]** → The official feed is checked
  against the repo manifests; installed/consent/detail surfaces prefer the
  manifest; the feed is display-only.
- **[A feed becomes unavailable]** → Per-feed error isolation and retry;
  installed management and URL install keep working.
- **[Third-party feed privacy]** → Lazy loading, no persistence, no
  credentials/referrer, icons optional and non-blocking.
- **[More UI in the primary side bar]** → One compact view with two sections and
  search; no virtualization up to the 500-entry cap; styles follow the
  workbench tokens.
- **[Moved controls confuse existing users]** → The Settings debug section links
  to Extensions; the palette command and View menu make the new view
  discoverable; the README/walkthrough record the new path.
- **[Bundle growth]** → The feature is shell UI and a small parser; measure the
  budget and keep it explicit rather than silently raising it.
- **[Feed source list is a deployment footgun]** → Absolute URLs, a missing or
  invalid file is an explicit empty/error state, and the deploy check validates
  the committed default.
- **[Details tabs add a shell tab kind]** → Reuse the existing content-tab
  metadata and close path; no dirty state, no provider write, no plugin frame.

## Migration Plan

1. Land `surface-companion-panels` and confirm shell `0.11.0` is deployed.
2. Merge this change with hidden-by-default UI hooks? No: the Extensions view is
   additive and the old Settings controls are removed in the same change, so
   there is no dual-management release to roll back.
3. Update the shell and docs, run the full verify gate, copy the marketplace
   assets after the budget check, and deploy.
4. Verify against the deployed URL: official feed reachable, catalog loads,
   install writes `exo.json`, consent appears, disable/remove works, Settings
   debug still works.
5. If rollback is needed, revert the change. Installed entries are ordinary
   `exo.json` entries and need no cleanup; the deployed feed can stay because
   older shells never request it.

## Deployed Verification

Verified on 2026-11-27 against deployed commit `badc141` (asset
`index-BzTsJ4_t.js`) at `https://mode777.github.io/exo-editor/` with
`chrome-headless-shell` 131.0.6778.264 at 1280x800 and an OPFS workspace opened
through a `showDirectoryPicker` stub. The feed is
`https://mode777.github.io/exo-editor/marketplace.json` and the source list is
`https://mode777.github.io/exo-editor/marketplace-sources.json`; both returned
200 with the committed content. CI `verify` passed and Pages deployed after one
retry that removed duplicate `github-pages` artifacts.

Observed path:

- No workspace: Extensions loaded the official feed, showed Exo Code and Exo
  Template Plugin with source **Exo Plugins**, search filtered the catalog,
  details opened with feed metadata and the manifest URL, and install actions
  were disabled with the folder explanation.
- Writable workspace: install wrote one canonical enabled `exo.json` entry, the
  consent dialog named the manifest origin and capabilities, approval activated
  the plugin, details showed `workspace:read`, Disable rewrote only the enabled
  flag, Remove deleted the entry, and Settings showed **Plugin debugging** with
  raw `exo.json` and no install/remove/promote controls.
- Read-only workspace: restored after denying permission, showed the read-only
  state, disabled the template Install action and install-by-URL, and kept
  details reachable.
- Missing source, invalid feed and invalid `exo.json`: each produced the
  specified error/issue state with Retry where applicable; no write occurred,
  and the URL form stayed available when the workspace was writable.
- Theme and width: Extensions rendered in dark and light with different computed
  title colors and remained usable at 900x700 without horizontal body scroll.
- Catalog first load: 108-138 ms (median 118 ms) after opening Extensions, two
  requests (source and feed), no marketplace request before the view opened.
  No page errors or unexpected console errors were recorded.
- Bundle: 183,791 JS / 14,456 CSS gzip bytes before the plugin copies, against
  the 186,000/14,600 budget.
