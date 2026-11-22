# Plugin Styling Contract (v1)

Status: introduced by the OpenSpec change `plugin-theming`. Normative
requirements are mirrored in `openspec/specs/plugin-styling/spec.md`. The theme
values themselves stay in [`docs/contracts/events.md`](./events.md); this
contract defines the optional author-facing palette and helper.

## 1. Purpose

The shell tells a plugin whether the workbench is `dark`, `light` or
`high-contrast`, but it does not send CSS and cannot share its document. This
contract defines the supported way for a plugin to turn that theme name into a
consistent page: a small `data-theme` convention, two SDK helpers and an optional
semantic token stylesheet.

Styling is not a trust boundary. A plugin may ignore this contract entirely and
ship its own palette. It still may not read shell DOM, storage or CSS, and no
styling API changes the consent surface, permissions or protocol.

## 2. Theme value

- The authoritative value is `shell/init.theme`, one of `dark`, `light` or
  `high-contrast`. `theme/changed` delivers later values.
- Initial state is in `shell/init`; a frame can style itself without subscribing.
  Live updates require the manifest's `events:subscribe` permission.
- The shell never sends resolved CSS custom properties. `theme/changed` carries
  the theme name only, as ratified in
  [`docs/contracts/events.md`](./events.md#8-resolved-during-ratification).

## 3. Theme attribute

After connecting, a plugin SHOULD place the exact shell theme name on its
document root:

```html
<html data-theme="dark"></html>
```

- The attribute values are exactly `dark`, `light` and `high-contrast`.
- Once the attribute is set it is authoritative. `prefers-color-scheme` is only
  a pre-handshake fallback; it MUST NOT override an explicit `data-theme`.
- The attribute is local page state. It is not persisted by the shell, is not
  workspace-scoped and does not survive a reload unless the plugin stores it in
  its own storage (cross-origin plugins only; same-origin plugins have no
  storage).
- A plugin MUST NOT set an inline `style` attribute merely to apply a theme when
  a stylesheet can express it. The SDK helper only writes `data-theme`, so it
  works under a CSP without `style-src 'unsafe-inline'`.

## 4. SDK helper

`@exo/plugin-sdk/theme` is a DOM-only entry point. It is not exported by the
DOM-free core; importing `@exo/plugin-sdk` does not read `document`.

```ts
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import '@exo/plugin-sdk/theme.css'
import { followTheme } from '@exo/plugin-sdk/theme'

const connection = await connectBrowserPlugin()
if (connection.mode !== 'editor') throw new Error('Expected editor mode')

const stopTheme = await followTheme(connection.editor, {
  onTheme: (theme) => applyEditorTheme(theme),
})
```

### `applyTheme(theme, options?)`

- Writes `theme` to `data-theme` on `options.document.documentElement`, or the
  global document when omitted.
- Writes no other attribute, class or inline style.
- Returns `void`.

### `followTheme(client, options?)`

- Applies `client.initialization.theme` immediately and invokes
  `options.onTheme` with that initial value.
- When `client.initialization.permissions` includes `events:subscribe`, sends
  one `plugin/subscribe` for `theme/changed`, applies each later value and
  invokes `options.onTheme` with it.
- Without `events:subscribe`, sends no message and resolves with a no-op
  cleanup.
- Resolves with a cleanup that removes the helper's event listener. It does not
  unsubscribe the topic, because other listeners in the same frame may share it.
- If the subscription request fails, rejects after the initial theme has been
  applied; the caller can show a diagnostic and keep the initial palette.
- Is not a save, dirty, navigation or lifecycle API and adds no protocol
  message.

A plugin that manages its own subscription can use `applyTheme` directly:

```ts
if (editor.initialization.permissions.includes('events:subscribe')) {
  await editor.subscribe('theme/changed')
  editor.onEvent('theme/changed', (event) => applyTheme(event.payload.theme))
}
applyTheme(editor.initialization.theme)
```

## 5. Token stylesheet

`@exo/plugin-sdk/theme.css` is an optional stylesheet. Importing it does not
load JavaScript. Import it before the plugin's own component styles:

```ts
import '@exo/plugin-sdk/theme.css'
import './editor.css'
```

The sheet:

- defines the shared typography and radius tokens on `:root`;
- defines the dark palette on `:root`;
- defines the complete light palette on `:root[data-theme='light']`;
- defines the complete high-contrast palette on
  `:root[data-theme='high-contrast']`;
- repeats the light palette for `:root:not([data-theme])` inside
  `@media (prefers-color-scheme: light)` as the pre-handshake fallback;
- sets `color-scheme` to `dark`, `light` or `dark` (high contrast) so native
  controls, scrollbars and the caret match;
- sets no body margin, layout, component or editor styles.

A plugin may override any token in its own CSS after the import. It should keep
the token names and semantic meanings so a later theme follows without
component changes. Component CSS SHOULD consume `var(--exo-*)` instead of raw
palette values.

## 6. Tokens

All themes define every theme-dependent token. The shared tokens are the same in
all themes.

| Token                 | Meaning                               | Dark      | Light     | High contrast |
| --------------------- | ------------------------------------- | --------- | --------- | ------------- |
| `--exo-bg`            | Page and document background          | `#1f1f1f` | `#ffffff` | `#000000`     |
| `--exo-fg`            | Default text                          | `#cccccc` | `#3b3b3b` | `#ffffff`     |
| `--exo-muted-fg`      | Secondary and hint text               | `#9d9d9d` | `#616161` | `#c8c8c8`     |
| `--exo-border`        | Decorative separators and outlines    | `#3c3c3c` | `#d4d4d4` | `#6fc3df`     |
| `--exo-surface`       | Toolbars, notices and raised regions  | `#181818` | `#f8f8f8` | `#000000`     |
| `--exo-surface-hover` | Hover state on a surface              | `#2a2d2e` | `#e8e8e8` | `#1a1a1a`     |
| `--exo-accent`        | Primary action or active indicator    | `#0078d4` | `#005fb8` | `#0078d4`     |
| `--exo-accent-fg`     | Text on the accent                    | `#ffffff` | `#ffffff` | `#ffffff`     |
| `--exo-accent-hover`  | Primary action hover                  | `#026ec1` | `#0258a8` | `#026ec1`     |
| `--exo-focus`         | Focus ring and active outline         | `#3794ff` | `#005fb8` | `#f38518`     |
| `--exo-link`          | Links and text actions                | `#4daafc` | `#005fb8` | `#3794ff`     |
| `--exo-selection-bg`  | Text selection background             | `#264f78` | `#add6ff` | `#264f78`     |
| `--exo-selection-fg`  | Text selection foreground             | `#ffffff` | `#1f1f1f` | `#ffffff`     |
| `--exo-input-bg`      | Input, textarea and select background | `#1f1f1f` | `#ffffff` | `#000000`     |
| `--exo-input-fg`      | Input text                            | `#cccccc` | `#3b3b3b` | `#ffffff`     |
| `--exo-input-border`  | Input boundary                        | `#6b6b6b` | `#767676` | `#6fc3df`     |
| `--exo-danger`        | Error text and destructive emphasis   | `#f85149` | `#c62828` | `#ff6b6b`     |
| `--exo-warning`       | Warning text                          | `#cca700` | `#8a6700` | `#ffcc00`     |
| `--exo-success`       | Success text                          | `#81b88b` | `#2f7d32` | `#89d185`     |
| `--exo-font-ui`       | UI font stack                         | _shared_  | _shared_  | _shared_      |
| `--exo-font-mono`     | Code and monospace stack              | _shared_  | _shared_  | _shared_      |
| `--exo-font-size`     | Base UI size, `13px`                  | _shared_  | _shared_  | _shared_      |
| `--exo-radius`        | Control radius, `4px`                 | _shared_  | _shared_  | _shared_      |

`--exo-font-ui` is
`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif`.
`--exo-font-mono` is
`'SF Mono', Monaco, Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace`.

## 7. Usage rules

- Text token pairs clear WCAG 2.2 AA contrast (4.5:1) in all three themes; the
  focus token clears 3:1 against `--exo-bg` and `--exo-surface`. A plugin that
  overrides values owns the resulting contrast check.
- Use `:focus-visible` with `outline: 2px solid var(--exo-focus)` and an offset;
  do not remove a focus indicator without a replacement that meets 3:1.
- Use `var(--exo-selection-bg)` and `var(--exo-selection-fg)` for `::selection`;
  do not rely on the browser default across themes.
- Set `accent-color: var(--exo-accent)` and, where supported,
  `scrollbar-color: var(--exo-border) var(--exo-bg)` for native controls. The
  stylesheet's `color-scheme` covers the rest.
- Status colors are text colors, not the only carrier of meaning. Pair them with
  a label, icon or pattern.
- Honour `prefers-reduced-motion`; the shell's own global rule does not cross the
  iframe boundary.
- Do not recreate shell chrome (tabs, breadcrumbs, status bar, Save) inside the
  frame. The shell owns those surfaces; the plugin styles its document content.
- Editor libraries with their own theme model (Monaco, CodeMirror, ...) keep
  that model. Map `dark`, `light` and `high-contrast` to the library's themes in
  the same `onTheme` callback; the CSS tokens style the surrounding page.
- A hidden handler frame has no visible surface and needs no palette.

## 8. `vscode-workbench` compatibility

The shell composes `vscode-workbench` and uses its public style entries. Those
entries are not part of the plugin contract and are `0.x`. A plugin that already
renders `vscode-workbench` components may import
`vscode-workbench/styles/tokens.css`; the SDK helper sets the same `data-theme`
attribute those selectors read. The SDK token sheet remains the recommended
route for a standalone plugin because it is small, has no peer dependencies and
covers `high-contrast`.

## 9. Compatibility

- Added in SDK `1.8.0` as an additive minor. Protocol major `1`, manifest schema
  `1`, permissions and the consent fingerprint are unchanged.
- Token names and semantics are stable within SDK major `1`. New tokens are
  additive. Removing or renaming a token requires the next SDK major and an
  upgrade note.
- Palette values may be tuned in a minor release for contrast, platform
  consistency or a new shell theme; the changelog records a material change.
- The theme helpers are optional. A plugin that does not import them keeps its
  current appearance and behavior.
