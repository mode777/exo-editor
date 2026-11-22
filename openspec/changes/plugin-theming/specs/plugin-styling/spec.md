# Spec Delta

## Purpose

Defines the optional SDK styling surface that turns the shell's theme name into a
consistent plugin page across the dark, light and high-contrast themes without
sending resolved shell tokens over the protocol.

## ADDED Requirements

### Requirement: Theme attribute helper

The SDK SHALL provide a DOM-only theme entry point with `applyTheme(theme,
options?)` that writes the exact shell theme name to `data-theme` on the target
document's root element, and SHALL NOT write inline style attributes.

#### Scenario: Apply an initial theme

- **WHEN** a plugin calls `applyTheme('light')` after the handshake
- **THEN** the document element carries `data-theme="light"` and no inline style
  attribute is added by the helper

#### Scenario: Apply every shell theme

- **WHEN** the plugin applies `dark`, `light` or `high-contrast`
- **THEN** the document element carries that exact value

#### Scenario: Custom document

- **WHEN** the plugin passes a different `Document` through the options
- **THEN** the helper writes the attribute on that document's root and leaves the
  global document untouched

### Requirement: Follow shell theme changes

The SDK SHALL provide `followTheme(client, options?)` that applies the
initialization theme immediately, subscribes to `theme/changed` when the
manifest holds `events:subscribe`, applies each delivered theme, invokes an
optional callback for the initial and every later theme, and returns a cleanup
for its listener.

#### Scenario: Initial theme without event permission

- **WHEN** `shell/init` carries a theme and the permissions omit
  `events:subscribe`
- **THEN** `followTheme` applies the initial theme, sends no subscription message
  and resolves with a no-op cleanup

#### Scenario: Initial theme with event permission

- **WHEN** the permissions include `events:subscribe`
- **THEN** `followTheme` applies the initialization theme, sends one
  `plugin/subscribe` for `theme/changed` and resolves after the correlated
  acknowledgement

#### Scenario: Theme change is applied

- **WHEN** a subscribed frame receives `theme/changed` with `light`
- **THEN** the document element carries `data-theme="light"` and the optional
  callback receives `light`

#### Scenario: Callback sees the initial theme

- **WHEN** the initialization theme is `dark` and the plugin passes a callback
- **THEN** the callback receives `dark` before any change event

#### Scenario: Cleanup

- **WHEN** the plugin invokes the cleanup returned by `followTheme`
- **THEN** later `theme/changed` deliveries no longer update the document or call
  the plugin's callback

### Requirement: Theme token stylesheet

The SDK SHALL ship an optional `theme.css` whose tokens cover the page
background, foreground, muted text, border, surface, hover surface, accent,
accent text, accent hover, focus, link, selection, input, danger, warning,
success, UI font, monospace font, base font size and radius, and SHALL define a
complete palette for `dark`, `light` and `high-contrast`.

#### Scenario: Explicit theme blocks

- **WHEN** the document element carries `data-theme="dark"`, `"light"` or
  `"high-contrast"`
- **THEN** every theme-dependent token resolves from that theme's block

#### Scenario: Pre-handshake fallback

- **WHEN** the document element has no `data-theme` attribute
- **THEN** the stylesheet follows `prefers-color-scheme` for the initial page and
  `color-scheme` describes the used scheme

#### Scenario: Native controls

- **WHEN** the stylesheet is imported
- **THEN** `color-scheme` matches the active theme so form controls, scrollbars
  and the caret use the correct platform mode

#### Scenario: No protocol dependency

- **WHEN** a plugin uses the stylesheet
- **THEN** no CSS custom property is requested from or delivered by the shell and
  `theme/changed` still carries only the theme name

#### Scenario: Contrast

- **WHEN** the token pairs for text on background, muted text on background,
  accent text on accent and status text on background are measured
- **THEN** they meet WCAG 2.2 AA text contrast in all three themes, and the focus
  token meets the 3:1 non-text requirement against the page and surface
  backgrounds

### Requirement: Styling guidance and skill

The author guide and the `create-exo-plugin` skill SHALL explain the SDK theme
surface, the token stylesheet, editor-library theme mapping and the checks for
both themes, and SHALL NOT require a plugin to import shell internals.

#### Scenario: Guide path

- **WHEN** an author follows the styling page and the SDK page with only the
  starter template
- **THEN** the author can add a themed surface that follows the shell's initial
  theme and later changes using documented SDK imports

#### Scenario: Skill path

- **WHEN** the skill scaffolds a visible editor
- **THEN** its steps include the token import, the theme helper, a token-based
  CSS example and a light/dark verification item

#### Scenario: Existing palette

- **WHEN** a plugin already uses `vscode-workbench` public style entries
- **THEN** the guide identifies that as an optional existing path and keeps the
  SDK token sheet as the recommended plugin-owned route
