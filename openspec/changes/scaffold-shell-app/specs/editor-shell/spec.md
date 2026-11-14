# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
