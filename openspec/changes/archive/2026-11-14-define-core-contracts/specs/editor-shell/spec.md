# Spec Delta

## Purpose

Defines the shell as the product: a static, backend-free workbench that composes
the reused workbench kit, owns the workspace and plugin surfaces, and gives no
editor privileged access.

## ADDED Requirements

### Requirement: Static, backend-free delivery

The shell SHALL be deliverable as static assets with no server-side runtime, API
proxy, account system or secret in the client bundle, and SHALL publish through a
push-triggered GitHub Pages workflow.

#### Scenario: Deployed artifact is static

- **WHEN** the production build output is inspected
- **THEN** it consists of HTML, JavaScript, CSS and asset files, makes no request to a first-party API, and contains no credential

#### Scenario: Push deploys, pull request verifies

- **WHEN** a commit lands on the main branch
- **THEN** the workflow builds and publishes the site, while a pull request runs the same checks without deploying

### Requirement: Shell content security policy

The deployed shell SHALL send a CSP with `frame-src https:`, `connect-src 'self'
https:`, `script-src 'self'` and no `unsafe-eval` or `unsafe-inline` script
sources, so plugin code cannot execute in the shell's realm and no privileged
evaluation path exists.

#### Scenario: Plugin code stays in its frame

- **WHEN** a plugin manifest or entry tries to inject script into the shell
- **THEN** the CSP blocks it and the plugin remains confined to its iframe

#### Scenario: No evaluation

- **WHEN** the shell handles plugin-supplied data
- **THEN** it does not pass it to `eval`, `new Function` or an equivalent dynamic
  evaluation API

### Requirement: Shell composes the workbench kit

The shell SHALL depend on the published `vscode-workbench` package and compose it
through public exports and preset props (`views`, `renderDocument`, `commands`,
`menus`, `quickOpen`, `fileIcons`, `statusBar`, `initialSession`), and SHALL
supply its own explorer, document area and commands. It SHALL NOT copy, vendor or
patch upstream demo modules or preset source.

#### Scenario: No upstream demo dependency

- **WHEN** the shell source is searched for upstream demo views, mock workspace data or vendored preset source
- **THEN** none are present, and the only upstream imports are from the published package's public entry points

#### Scenario: Explorer is Exo-owned

- **WHEN** a workspace is open in the shell
- **THEN** the explorer renders the workspace provider's tree and never the upstream mock tree

#### Scenario: Kit upgrade is a dependency change

- **WHEN** the pinned `vscode-workbench` minor is upgraded
- **THEN** the composition compiles and the shell verifies its props against the package's public types without editing vendored code

### Requirement: No editor is privileged

No editor implementation SHALL be compiled into the shell bundle or receive
privileged access to shell state, and the reference code editor SHALL load only
through the plugin protocol.

#### Scenario: Shell bundle excludes the reference editor

- **WHEN** the shell bundle is inspected
- **THEN** it contains no Monaco code, and the reference editor is a separately deployed plugin

#### Scenario: Disabling the reference editor degrades cleanly

- **WHEN** the reference editor plugin is disabled in settings
- **THEN** matching files fall back to the shell-owned document renderer and no privileged code path remains active

### Requirement: Workspace switch resets workspace-scoped state

Loading a different workspace SHALL reset open tabs, plugin registrations,
handler sessions, watchers, caches, event subscriptions and workspace-scoped
settings, while retaining global layout and theme preferences. A callback
belonging to a released workspace SHALL NOT be able to mutate shell state.

#### Scenario: Nothing survives a switch

- **WHEN** a user switches from workspace A to workspace B
- **THEN** no tab, registration, handler session, watcher, cached file or plugin setting from A is observable in B

#### Scenario: Late callback is dropped

- **WHEN** a workspace operation or watcher callback from A resolves after B is ready
- **THEN** the shell ignores it and B's state is unchanged

### Requirement: Workspace configuration is shell-only

`exo.json` at the workspace root and everything under `/.exo/` SHALL be readable
and writable only by shell code, and no plugin-facing API, message or document
path SHALL expose them.

#### Scenario: Plugin cannot read the declaration

- **WHEN** a plugin requests `/exo.json` or any path under `/.exo/`
- **THEN** the shell rejects the request with `permission-denied` and returns no content or metadata

#### Scenario: Declaration is not openable as a document

- **WHEN** the explorer or command palette attempts to open `exo.json` as a normal document
- **THEN** the shell routes to the plugin settings surface instead of creating an editable tab

#### Scenario: Shell may edit the declaration

- **WHEN** the user changes plugin configuration through the shell's settings UI
- **THEN** the shell reads and rewrites the file directly and no plugin participates in the write
