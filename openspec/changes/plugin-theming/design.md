# Design

## Context

See `proposal.md` for motivation. The shell surfaces the theme name only:
`shell/init.theme` and `theme/changed` carry `dark`, `light` or
`high-contrast`, and the events contract deliberately rejects sending resolved
CSS custom properties. A plugin frame is a separate document, so it cannot
inherit the shell's `vscode-workbench` tokens. The SDK already has a DOM-free
core plus explicit DOM-only entries (`@exo/plugin-sdk/browser` and
`@exo/plugin-sdk/theme`); the package is consumed as TypeScript source and
vendored into standalone plugin repos.

The guide currently covers the protocol and SDK but has no styling page. The
reference code plugin has its own `--exo-code-*` palette and subscribes to
`theme/changed` by hand; the template is headless and has no visual surface.

## Goals / Non-Goals

**Goals:**

- Give a plugin one documented, small setup that keeps its page in the shell's
  current theme without importing shell internals.
- Keep the tokens semantic and stable enough to document, while leaving syntax
  colors and editor internals to the editor library.
- Cover all three protocol theme values, including the pre-handshake flash.
- Make the same pattern appear in the guide, the skill, the SDK README and the
  reference plugin so the documentation is exercised.

**Non-Goals:**

- Runtime token synchronization or a new protocol message.
- Reusing `vscode-workbench`'s `--vscode-*` tokens as a plugin API. Those are a
  public style entry for applications composing the kit, but the package is
  `0.x`, carries only dark/light and would couple every plugin to the shell's
  chrome version.
- Replacing Monaco, CodeMirror or another editor library's own theme model.
- Theme persistence, a plugin theme picker, or per-plugin brand palettes.

## Decisions

### D1 - SDK-owned semantic tokens, not shell tokens

`theme.css` defines `--exo-*` tokens. They are intentionally a small semantic
set: page, text, muted text, border, surface, accent, focus, link, selection,
input, status and typography. They are not a copy of the workbench palette, so
the shell can change its chrome without silently changing every plugin, and the
events contract's "theme name only" rule still holds.

Alternatives: send resolved CSS variables in `theme/changed` (new token contract
and payload growth), document `vscode-workbench/styles/tokens.css` as the plugin
API (couples plugins to a `0.x` React package and leaves no high-contrast
block), or let every author invent tokens (the current state).

### D2 - `data-theme` is the contract boundary

The helper writes the exact shell theme name to `document.documentElement`
`data-theme`, matching the shell's own workbench attribute and
`vscode-workbench`'s theme selectors. CSS owns the palette and `color-scheme`;
the helper writes no inline style, so a plugin with a strict CSP does not need
`style-src 'unsafe-inline'`. A plugin that already imports a
`vscode-workbench` style entry can use the same attribute.

### D3 - Two helper levels

`applyTheme(theme, options?)` is the primitive for a plugin that already manages
its own subscription or only needs the initial state. `followTheme(client,
options?)` is the common path: it applies the initialization theme, checks
`events:subscribe`, subscribes to `theme/changed`, applies each update and calls
an optional `onTheme` callback with the initial and later values. The callback is
how an editor library maps the shell theme to its own theme (Monaco `vs`,
`vs-dark`, `hc-black`).

`followTheme` does not unsubscribe on cleanup because the SDK's `unsubscribe`
drops every listener for the topic; cleanup only removes the helper's listener.
It resolves with the no-op cleanup when the permission is absent. If the
subscription request itself fails, it rejects after applying the initial theme,
so the plugin can show a diagnostic and continue with the initial palette.

### D4 - One stylesheet, three explicit blocks

`theme.css` uses a dark root block, explicit `[data-theme='light']` and
`[data-theme='high-contrast']` blocks, and a
`@media (prefers-color-scheme: light)` block scoped to `:root:not([data-theme])`.
The fallback only matters before the handshake; once the helper runs, the
attribute is authoritative. Shared typography and radius tokens live on `:root`;
every theme block repeats the complete theme-dependent palette so a consumer can
read one block and see every color. The small duplication is deliberate and the
CSS test enforces completeness.

`color-scheme` is declared by the same blocks, so native controls, scrollbars and
the caret follow the theme. The sheet sets no `body` margin, layout or editor
styles; it stays a token sheet rather than a reset.

### D5 - Token set

| Token                 | Meaning                                    |
| --------------------- | ------------------------------------------ |
| `--exo-bg`            | Page and document background               |
| `--exo-fg`            | Default text                               |
| `--exo-muted-fg`      | Secondary and hint text                    |
| `--exo-border`        | Decorative separators and outlines         |
| `--exo-surface`       | Toolbars, notices and raised regions       |
| `--exo-surface-hover` | Hover state on a surface                   |
| `--exo-accent`        | Primary action or active indicator         |
| `--exo-accent-fg`     | Text on the accent                         |
| `--exo-accent-hover`  | Primary action hover                       |
| `--exo-focus`         | Focus ring and active outline              |
| `--exo-link`          | Links and text actions                     |
| `--exo-selection-bg`  | Text selection background                  |
| `--exo-selection-fg`  | Text selection foreground                  |
| `--exo-input-bg`      | Text field, textarea and select background |
| `--exo-input-fg`      | Input text                                 |
| `--exo-input-border`  | Input boundary                             |
| `--exo-danger`        | Error text and destructive emphasis        |
| `--exo-warning`       | Warning text                               |
| `--exo-success`       | Success text                               |
| `--exo-font-ui`       | UI font stack                              |
| `--exo-font-mono`     | Code and monospace stack                   |
| `--exo-font-size`     | 13px base size                             |
| `--exo-radius`        | 4px control radius                         |

Palette values follow the shell's VS Code-style intent but are chosen for
contrast: dark page `#1f1f1f`/`#cccccc`, light page `#ffffff`/`#3b3b3b`, high
contrast `#000000`/`#ffffff`. Text pairs clear 4.5:1 and the focus token clears
3:1 against the page and surface. Syntax highlighting is explicitly not part of
the token set.

### D6 - Documentation is the consumer

The guide page teaches the helper and a token-based page, then delegates the
normative token list to the contract. The skill gets the same setup as a build
step so a generated plugin starts themed. The reference code plugin imports the
SDK sheet and uses `followTheme`; Monaco keeps its own `vs`/`vs-dark`/`hc-black`
mapping through the callback. The template stays headless, so it only documents
the option.

## Risks / Trade-offs

- **Token drift from the shell palette** -> the tokens are semantic, not a
  pixel-parity promise; the contract and CSS test pin the set and the guide tells
  authors to use them consistently rather than match the shell exactly.
- **A plugin uses the tokens but forgets `color-scheme`** -> importing
  `theme.css` sets it; a plugin that writes its own CSS must include the
  equivalent rule, as the guide states.
- **High contrast is rarely exercised** -> the token block, contract scenario
  and guide checklist include it, and the helper applies the value without a
  mapping table.
- **Editor libraries do not accept CSS tokens** -> the `onTheme` callback gives
  them the shell name; the reference plugin shows the Monaco mapping.
- **Flash before the handshake** -> the fallback media query follows the OS
  scheme; the helper corrects it as soon as `shell/init` arrives.
- **CSP-sensitive plugins** -> the helper only writes an attribute; palette and
  `color-scheme` live in a normal stylesheet.

## Migration Plan

1. Add the SDK theme source and stylesheet, package exports and `sideEffects`
   entry; bump the SDK to `1.8.0`.
2. Add the contract, guide page and skill step; update the reference plugin to
   consume them.
3. Bump the shell release to `0.7.0` for the deployed documentation and SDK
   addition; protocol `1`, manifest schema `1` and the consent fingerprint are
   unchanged.
4. Existing plugins keep working with no change. Rollback is a redeploy of the
   previous commit; no state or schema migration is involved.

## Deployed verification

Recorded after the change is deployed: the reference code plugin follows the
initial theme and a live toggle, the token sheet resolves in both themes, and the
guide/skill links resolve from the deployed repository. Until then, the deployed
verification task stays open.
