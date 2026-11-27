# Spec Delta

## Purpose

Defines how a deployed shell discovers plugins from fixed marketplace feeds and
lets the user install, inspect and manage them in the current workspace without
bypassing the manifest, consent or workspace-write rules.

## ADDED Requirements

### Requirement: Deployment-scoped marketplace sources

The shell SHALL load its feed list from `marketplace-sources.json` on its own
origin, SHALL treat that list as fixed for the deployment, and SHALL NOT offer a
runtime control that adds, removes or overrides a feed. A missing or invalid
source file SHALL disable catalog discovery without disabling installed-plugin
management or install by manifest URL.

#### Scenario: Fixed feed list

- **WHEN** the deployed `marketplace-sources.json` lists one or more feed URLs
- **THEN** the Extensions view loads those feeds in list order and offers no control to add or remove a feed

#### Scenario: Missing source file

- **WHEN** the source file is absent
- **THEN** the Marketplace section shows that this deployment has no feeds, and installed management and install by URL remain usable

#### Scenario: Invalid source file

- **WHEN** the source file is not valid JSON, fails validation or exceeds its limit
- **THEN** the shell fetches no feed, shows the reason with a retry action, and leaves installed management and install by URL usable

#### Scenario: Sources are deployment state

- **WHEN** a workspace is open and the user looks for a marketplace settings control
- **THEN** no workspace file, plugin declaration or shell preference can change the feed list

#### Scenario: No workspace is required

- **WHEN** the page loads with no workspace open
- **THEN** the Extensions view can still load and display the configured catalog while install actions are disabled

### Requirement: Marketplace feed format

A marketplace feed SHALL be strict JSON with `schemaVersion` `1`, a stable `id`,
a display `name`, an `owner` with a `name`, and a `plugins` array. Each plugin
entry SHALL have a display `name` and an absolute manifest URL using `https` or
`http://localhost`; optional display metadata SHALL be bounded and unknown
fields SHALL be rejected.

#### Scenario: Valid feed is accepted

- **WHEN** a feed has the required envelope, one owner and a valid plugin entry
- **THEN** validation succeeds and the entry appears in the catalog with its display metadata

#### Scenario: Unknown fields are rejected

- **WHEN** a feed or plugin entry contains a field the schema does not define
- **THEN** validation fails with a named field and no entry from that feed is used

#### Scenario: Invalid manifest URL

- **WHEN** an entry's `manifest` is relative, uses plain HTTP outside `localhost`, contains credentials or contains a fragment
- **THEN** validation fails for that feed and the URL is not offered for installation

#### Scenario: Duplicate manifest in one feed

- **WHEN** one feed lists the same normalized manifest URL twice
- **THEN** validation fails for that feed instead of showing a duplicate row or truncating the list

#### Scenario: Feed limits

- **WHEN** a feed exceeds the entry, name, description, keyword or byte limits
- **THEN** validation fails for that feed with a stable issue code and no entry from it is used

#### Scenario: Display metadata is not authority

- **WHEN** feed metadata names a version, publisher or description that differs from the fetched manifest
- **THEN** the catalog may show the feed value until the manifest loads, and every installed, consent and details view uses the manifest value once available

#### Scenario: Legacy or future schema

- **WHEN** a feed declares a `schemaVersion` other than `1`
- **THEN** the shell rejects it with an unsupported-version issue and does not guess its fields

### Requirement: Feed loading and failure isolation

The shell SHALL fetch the source file and feeds lazily when the Extensions view
first opens, SHALL omit credentials, SHALL apply bounded timeouts and response
sizes, SHALL abort in-flight work when the shell is disposed, and SHALL isolate a
failing feed so the others remain usable. Catalog loading SHALL NOT mount a
frame, write workspace state or persist feed content.

#### Scenario: Lazy first load

- **WHEN** the page loads and the user never opens Extensions
- **THEN** the shell performs no marketplace source or feed request

#### Scenario: Opening Extensions starts loading

- **WHEN** the user opens Extensions for the first time
- **THEN** the shell loads the source file and then the configured feeds, with a visible loading state

#### Scenario: One feed fails

- **WHEN** one feed times out, is blocked by CORS, returns a non-success status or fails validation
- **THEN** that feed shows its own error and retry action while entries from valid feeds remain usable

#### Scenario: Source failure

- **WHEN** the source file cannot be fetched or parsed
- **THEN** no feed request starts and the view shows the source error with a retry action

#### Scenario: No frames or workspace writes

- **WHEN** a feed loads and renders its entries
- **THEN** no iframe is created, no manifest is fetched and no workspace file changes

#### Scenario: Refresh

- **WHEN** the user invokes Refresh in the Extensions view
- **THEN** the shell re-fetches the source and feeds and replaces the catalog state without touching installed entries

#### Scenario: Late result is ignored

- **WHEN** a source or feed response resolves after the shell is disposed
- **THEN** it cannot update catalog state

#### Scenario: Catalog is deployment-scoped

- **WHEN** the user switches workspaces
- **THEN** the loaded catalog may stay in memory because it belongs to the deployment, while installed state is re-read from the new workspace

### Requirement: Catalog discovery

The Extensions view SHALL present an **Installed** section derived from the
active workspace declaration and a **Marketplace** section derived from the
configured feeds, SHALL filter both with one search field, and SHALL mark a
catalog entry as installed when its normalized manifest URL is already declared.

#### Scenario: Installed section

- **WHEN** the workspace declaration has valid enabled, disabled or failed entries
- **THEN** each entry appears once with its manifest-backed name when available, publisher, version, origin and current state

#### Scenario: Marketplace section

- **WHEN** a feed loads valid entries
- **THEN** each entry shows its name, publisher when supplied, description and source feed name

#### Scenario: Already installed

- **WHEN** a catalog entry's manifest URL matches an installed entry
- **THEN** the catalog row reports that it is installed or disabled and offers no second install action

#### Scenario: Duplicate across feeds

- **WHEN** two feeds list the same normalized manifest URL
- **THEN** the catalog shows one entry from the earlier feed in deployment order

#### Scenario: Search

- **WHEN** the user types in the search field
- **THEN** both sections filter by name, publisher, description and keywords without a network request

#### Scenario: Empty and offline states

- **WHEN** a feed is empty, the search matches nothing or the network is offline
- **THEN** the view shows an explicit empty or error state instead of a blank panel

#### Scenario: Installed-only plugin

- **WHEN** an installed entry is not listed by any configured feed
- **THEN** it still appears in Installed and remains manageable

### Requirement: Extensions activity-bar surface

The shell SHALL add a built-in **Extensions** item after Explorer in the activity
bar, SHALL register a primary side-bar view with search, Installed and
Marketplace sections, a refresh action and an install-by-URL form, and SHALL
provide a focus command with a keyboard shortcut. The view SHALL be usable
without a workspace for browsing.

#### Scenario: Activity item opens the view

- **WHEN** the user activates the Extensions activity-bar item
- **THEN** the primary side bar shows the Extensions view and the item reports the active state

#### Scenario: View structure

- **WHEN** the Extensions view is visible
- **THEN** it shows a labelled search field, an Installed section with a count, a Marketplace section and a Discover/Refresh action

#### Scenario: Install from URL

- **WHEN** the user submits a manifest URL in the Extensions view
- **THEN** the shell follows the same validation, duplicate, write and consent path as a legacy Settings add and reports the result next to the form

#### Scenario: No workspace

- **WHEN** no workspace is open
- **THEN** the view explains that a folder is required to install and keeps catalog browsing and details available

#### Scenario: Focus command

- **WHEN** the user runs the Extensions focus command or its shortcut
- **THEN** the primary side bar opens on the Extensions view without opening a second panel

#### Scenario: Keyboard and screen-reader operation

- **WHEN** the view is operated by keyboard or assistive technology
- **THEN** search, sections, rows, install/manage actions, errors and status changes have programmatic names, visible focus and live announcements

### Requirement: Install and manage in the current workspace

Installing SHALL add exactly one enabled manifest entry to the active workspace's
`exo.json` through the shell-owned configuration store and workspace session.
Enable, disable and remove SHALL use the same canonical versioned write path.
The shell SHALL require a ready, writable workspace and a valid or absent
declaration, and SHALL preserve the existing dirty-document guard.

#### Scenario: Install writes one entry

- **WHEN** the user installs a catalog entry in a writable workspace with a valid or absent declaration
- **THEN** one enabled entry with that manifest URL is written and the rest of the declaration is unchanged

#### Scenario: First install creates the declaration

- **WHEN** the workspace has no `exo.json`
- **THEN** install creates the canonical file with `schemaVersion: 1` and the selected entry

#### Scenario: Install requires a workspace

- **WHEN** no workspace is ready or the workspace is read-only
- **THEN** install and manage actions are disabled with an explanation and no file operation starts

#### Scenario: Invalid declaration blocks install

- **WHEN** `exo.json` is invalid or unreadable
- **THEN** install is disabled, existing issues remain visible and no partial write is attempted

#### Scenario: Duplicate install

- **WHEN** the manifest URL is already declared
- **THEN** the shell writes nothing, reports the duplicate and offers the existing entry's management action

#### Scenario: Dirty documents

- **WHEN** disabling, removing or revoking a plugin would close dirty documents
- **THEN** the existing save, discard and cancel prompt appears before the plugin or files change

#### Scenario: Host and consent path is unchanged

- **WHEN** an install writes a new entry
- **THEN** the host loads its manifest, validates it and requests consent exactly as for a manually added entry, and no frame is mounted before approval

#### Scenario: Failed install is recoverable

- **WHEN** an installed entry's manifest fails to load or is rejected
- **THEN** the entry remains visible with its failure code and can be reviewed or removed without editing `exo.json` by hand

#### Scenario: Workspace switch

- **WHEN** the workspace changes after an install
- **THEN** the previous workspace's installed state, actions and detail selection do not appear in the new workspace

### Requirement: Extension details surface

The shell SHALL open an extension's details in a shell-owned read-only tab
showing its feed or URL source, manifest URL, manifest metadata when loaded,
runtime state, permissions, contributed surfaces, consent actions and declared
settings. The details tab SHALL NOT contain feed HTML and SHALL close with the
workspace.

#### Scenario: Open details

- **WHEN** the user activates an installed or catalog row
- **THEN** one shell-owned details tab opens or is focused for that manifest URL

#### Scenario: Feed metadata yields to the manifest

- **WHEN** the manifest has loaded
- **THEN** details show the manifest name, id, version, publisher, description and origin instead of the feed's display values

#### Scenario: Runtime state

- **WHEN** the plugin is loading, awaiting consent, denied, registering, active or failed
- **THEN** the details tab shows that state, the stable error code and phase when present, and the matching review or retry action

#### Scenario: Permissions and contributions

- **WHEN** the manifest is valid
- **THEN** details list its permissions and its editor, panel, content-view, command and new-file contributions without rendering plugin HTML

#### Scenario: Contributed settings

- **WHEN** the manifest declares configuration
- **THEN** details render typed inputs, descriptions, current values, defaults and validation warnings under the `plugin-settings` rules

#### Scenario: Consent review and revoke

- **WHEN** the plugin is awaiting consent, denied or revoked
- **THEN** details offer Review consent, and an active plugin offers the guarded Revoke consent action

#### Scenario: Shell-owned tab lifecycle

- **WHEN** the user closes the details tab or switches workspaces
- **THEN** the tab closes without a dirty prompt and no plugin selection survives the workspace switch

#### Scenario: No feed markup

- **WHEN** a feed contains HTML, script text or a hostile URL in a display field
- **THEN** it is rendered as text or a bounded link and never interpreted as shell markup, an iframe source or executable code

### Requirement: Marketplace trust boundary

Marketplace content SHALL be untrusted discovery data. The shell SHALL NOT
auto-install, execute, import or grant authority from a feed, SHALL NOT treat
feed metadata as plugin identity or capability, and SHALL keep manifest
validation, origin confinement and consent unchanged. Remote icons and links
SHALL be optional, bounded and rendered without credentials or referrer data.

#### Scenario: Feed cannot install

- **WHEN** a catalog entry appears
- **THEN** no workspace write, manifest fetch or frame occurs until the user explicitly installs it

#### Scenario: Feed cannot widen authority

- **WHEN** a feed claims a plugin is safe or lists permissions the manifest does not declare
- **THEN** the claim grants nothing and consent continues to use the validated manifest

#### Scenario: Cross-origin manifest

- **WHEN** a feed from one origin lists a manifest on another origin
- **THEN** installation is allowed as discovery only and the normal consent prompt names the manifest origin and its capabilities

#### Scenario: Hostile display content

- **WHEN** a feed supplies script text, markup, an oversized string or an unsafe link
- **THEN** the shell displays escaped text, ignores the unsafe value or omits the action without changing shell state

#### Scenario: Icon privacy

- **WHEN** a feed supplies an icon
- **THEN** the shell requests it without credentials and without a referrer, and falls back to a shell icon when it fails

#### Scenario: No secrets

- **WHEN** the deployed shell fetches marketplace sources or feeds
- **THEN** the request carries no account credential, workspace token, consent record or token-bearing URL

### Requirement: Official feed and deployment

The repository SHALL contain an authoritative marketplace feed for the deployed
instance and a default source file that points at it. The deploy pipeline SHALL
publish both as static assets, SHALL support an operator override of the source
file at deploy time, and SHALL validate both documents before publishing.

#### Scenario: Deployed authoritative feed

- **WHEN** the shell is deployed to GitHub Pages
- **THEN** `/marketplace.json` is reachable next to the shell and lists the deployed reference plugins

#### Scenario: Default sources point at the official feed

- **WHEN** the default deployment configuration is used
- **THEN** `marketplace-sources.json` lists the official feed as its first source

#### Scenario: Deploy-time override

- **WHEN** an operator supplies a different source file or feed list at deploy time
- **THEN** the built artifact contains that list and no application code changes

#### Scenario: Feed validation gate

- **WHEN** the official feed or the source file is invalid, has duplicate manifest URLs or exceeds its limits
- **THEN** the verification job fails before deployment

#### Scenario: Feed matches shipped plugins

- **WHEN** the official feed is validated with the deployed plugin manifests
- **THEN** each shipped listing resolves to the expected manifest URL and its display version matches the manifest

#### Scenario: No credentials in marketplace assets

- **WHEN** the deployed artifact is scanned
- **THEN** neither marketplace file contains a credential, token or private URL
