# Proposal

## Why

Plugin authors get the shell theme name but no styling contract: the guide only
mentions `theme/changed`, every reference plugin invents its own palette, and a
new plugin has no supported way to look like part of the workbench. Plugins that
hard-code a dark surface stay dark when the user switches to the light theme, so
the document area no longer matches the shell. The shell already exposes the
initial theme and theme changes; what is missing is a small, optional author
surface that turns those values into a consistent page.

## What Changes

- Add an optional SDK theme surface:
  - `@exo/plugin-sdk/theme` exports `applyTheme(theme, options?)` and
    `followTheme(client, options?)`. `applyTheme` writes the shell theme name to
    `data-theme` on the document element. `followTheme` applies the initial
    theme, subscribes to `theme/changed` when the manifest has
    `events:subscribe`, invokes an optional callback for the initial and later
    themes, and returns a listener cleanup.
  - `@exo/plugin-sdk/theme.css` is a small semantic token sheet for `dark`,
    `light` and `high-contrast`, plus a `prefers-color-scheme` fallback used
    only before the handshake sets `data-theme`.
- Define the token names and theme behavior in a new
  [`docs/contracts/plugin-styling.md`](../../../docs/contracts/plugin-styling.md)
  contract. The tokens are owned by the SDK, not copied from the shell palette;
  `theme/changed` still carries only the theme name.
- Add an author-guide styling page covering the helper, tokens, native controls,
  editor-library themes, contrast, focus, reduced motion and the two-theme
  checklist. Link it from the guide index, the SDK page and the plugin template.
- Add a visual-styling step to the `create-exo-plugin` skill, including the
  helper call, a token-based CSS example and a light/dark verification check.
- Show the supported pattern in the reference code plugin: import the SDK token
  sheet, use `followTheme` for the initial and changed theme, and keep Monaco's
  own theme mapping.
- Bump the SDK to `1.8.0` and the shell release to `0.7.0` for the deployed
  documentation and SDK addition. Protocol `1` and manifest schema `1` are
  unchanged; no new permission, message, manifest field or consent fingerprint
  input is added.

**Explicit non-goals:** sending resolved CSS custom properties over the
protocol, syncing tokens at runtime, theming shell chrome from a plugin,
persisting a plugin theme, replacing an editor library's own theme system
(Monaco, CodeMirror, ...), and coupling plugins to `vscode-workbench`'s
`--vscode-*` palette. A plugin that already renders `vscode-workbench`
components may keep importing its public stylesheets; the SDK helper sets the
same `data-theme` attribute they use.

## Capabilities

### New Capabilities

- `plugin-styling`: the SDK theme helper, the optional token stylesheet, the
  three theme blocks, the pre-handshake fallback, and the author-facing styling
  rules.

### Modified Capabilities

- `plugin-sdk`: adds the DOM-only `@exo/plugin-sdk/theme` entry point, the
  `@exo/plugin-sdk/theme.css` export, the helper semantics and SDK `1.8.0`.
- `plugin-authoring`: requires the guide and the author skill to cover styling,
  both themes, the SDK helper/tokens, contrast and the verification checklist.

## Impact

- `packages/plugin-sdk`: new `theme.ts` and `theme.css`, package exports,
  `sideEffects` for CSS, tests, version `1.8.0`.
- `apps/code-plugin`: imports the SDK token sheet and uses `followTheme`; no
  protocol or manifest change.
- `docs/contracts/plugin-styling.md`, `docs/contracts/plugin-sdk.md`,
  `docs/contracts/events.md`; `docs/guide/styling.md`, the guide index/SDK page
  and `packages/plugin-sdk/README.md`.
- `.agents/skills/create-exo-plugin/SKILL.md`.
- `CHANGELOG.md`, `docs/releases.md`, `ROADMAP.md`, `README.md`, `AGENTS.md`.
- No shell runtime behavior, workspace contract, schema, consent, security
  boundary or bundle-budget change. The shell version records the deployed
  release that carries the documentation and SDK addition.
