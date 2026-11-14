# editor-shell Specification

## Purpose
Defines the shell as the product: a static, backend-free workbench that composes
the reused workbench kit, owns the workspace and plugin surfaces, and gives no
editor privileged access.

## Requirements

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

The deployed shell SHALL apply a CSP to its document with `frame-src https:`,
`connect-src 'self' https:`, `script-src 'self'` and no `unsafe-eval` or
`unsafe-inline` script sources, so plugin code cannot execute in the shell's
realm and no privileged evaluation path exists. Static hosting cannot set
response headers, so the policy SHALL be embedded in the shell's HTML document
and SHALL be present in the deployed build.

#### Scenario: Policy is embedded in the deployed document

- **WHEN** the deployed shell's HTML document is fetched
- **THEN** it carries a content security policy with `frame-src https:`, `connect-src 'self' https:` and `script-src 'self'`, and no `unsafe-eval` or `unsafe-inline` script source

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

### Requirement: Empty shell is a usable workbench

The deployed shell SHALL render a usable workbench with no workspace open: the
chrome fills the viewport with no body scroll, the primary surfaces are
operable by keyboard, and the explorer shows an explicit empty state.

#### Scenario: Renders at desktop and narrow widths

- **WHEN** the deployed URL is opened at 1440x900 and at a narrow width
- **THEN** the workbench renders fully within the viewport with no body scroll at either size

#### Scenario: Keyboard operable

- **WHEN** the user navigates the shell by keyboard alone
- **THEN** focus moves through the shell's primary surfaces and the command palette opens and closes from the keyboard

#### Scenario: Explorer is explicitly empty

- **WHEN** no workspace is open
- **THEN** the explorer shows an explicit empty state with no file tree and no mock workspace data

### Requirement: Layout session persists

The shell SHALL persist its layout session - panel and region visibility, sash
sizes and the active theme - and SHALL restore it when the page is reloaded.
Layout and theme are global preferences and SHALL survive a workspace switch
even though workspace-scoped state is reset (D7).

#### Scenario: Reload restores the layout

- **WHEN** the user changes the layout or theme and reloads the page
- **THEN** the shell comes back with the same layout and theme

#### Scenario: Theme survives a workspace switch

- **WHEN** the user switches workspaces after changing the theme
- **THEN** the theme preference is unchanged while workspace-scoped state is reset

### Requirement: Baseline commands work without a workspace

The shell SHALL offer the commands that need no workspace when none is open -
toggling the theme and opening the shell's settings surface - with palette
entries for them.

#### Scenario: Palette offers workspace-free entries

- **WHEN** no workspace is open and the command palette is opened
- **THEN** theme toggle and settings are listed and invoking them changes the theme and opens the shell's settings surface respectively

#### Scenario: Theme toggle applies immediately

- **WHEN** the user invokes the theme toggle
- **THEN** the shell switches to the other theme immediately without a reload

### Requirement: Bundle size budget is enforced

The build SHALL measure the production bundle against a committed size budget,
and the verification pipeline SHALL fail when the bundle exceeds it, so no size
regression lands silently.

#### Scenario: Budget blocks regressions

- **WHEN** the production bundle exceeds the committed budget
- **THEN** the pipeline fails and reports which measured sizes exceeded the budget

#### Scenario: Budget check runs on every pull request

- **WHEN** a pull request is opened
- **THEN** the pipeline builds the bundle and runs the budget check as part of the required gates
