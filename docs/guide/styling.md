# Styling

The shell owns the workbench chrome. Your plugin owns the document surface inside
its iframe, and that document does not inherit the shell's CSS. Style it as a
native part of the workbench by following the shell theme instead of hard-coding
one palette.

## What the shell gives you

- `shell/init.theme` is `dark`, `light` or `high-contrast`. It is available as
  soon as the connection resolves.
- `theme/changed` delivers later values. It requires `events:subscribe` in the
  manifest.
- No CSS, CSS custom properties or DOM node crosses the iframe boundary. The
  shell never sends its own stylesheet.

The optional SDK theme surface turns those values into a page without any
protocol work. The normative token list and values are in
[`docs/contracts/plugin-styling.md`](../contracts/plugin-styling.md).

## Recommended setup

Import the token sheet before your own CSS, then follow the shell theme once:

```ts
import '@exo/plugin-sdk/theme.css'
import './editor.css'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { followTheme } from '@exo/plugin-sdk/theme'

const connection = await connectBrowserPlugin()
if (connection.mode !== 'editor') throw new Error('Expected editor mode')
const editor = connection.editor

const stopTheme = await followTheme(editor, {
  onTheme: (theme) => {
    // Only needed when your editor library has its own theme model.
    applyEditorLibraryTheme(theme)
  },
})

editor.onDispose(() => {
  stopTheme()
  // Stop timers, workers and fetches here too.
})
```

`followTheme` does two things:

1. Applies `shell/init.theme` immediately and calls `onTheme` with it.
2. When the manifest has `events:subscribe`, subscribes to `theme/changed`,
   applies each new value and calls `onTheme` again.

Without `events:subscribe`, it still applies the initial theme and returns a
no-op cleanup; the page stays consistent until the user reloads. Add the
permission only if you want live theme changes.

If you already manage your own event subscription, use the primitive instead:

```ts
import { applyTheme } from '@exo/plugin-sdk/theme'

applyTheme(editor.initialization.theme)
// ...and on each theme/changed event:
applyTheme(event.payload.theme)
```

Neither helper persists a theme. The shell theme is authoritative while the
frame is open.

## Use the tokens

The sheet defines semantic `--exo-*` tokens for the page, text, surfaces, accent,
focus, selection, inputs, status text and typography. Keep those meanings and
override values only when your editor needs a specific palette:

```css
html,
body {
  height: 100%;
  margin: 0;
  background: var(--exo-bg);
  color: var(--exo-fg);
  font-family: var(--exo-font-ui);
  font-size: var(--exo-font-size);
}

.toolbar {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-bottom: 1px solid var(--exo-border);
  background: var(--exo-surface);
}

.toolbar button:hover {
  background: var(--exo-surface-hover);
}

textarea,
input {
  border: 1px solid var(--exo-input-border);
  border-radius: var(--exo-radius);
  background: var(--exo-input-bg);
  color: var(--exo-input-fg);
  font: inherit;
}

textarea:focus-visible,
input:focus-visible,
button:focus-visible {
  outline: 2px solid var(--exo-focus);
  outline-offset: 2px;
}

::selection {
  background: var(--exo-selection-bg);
  color: var(--exo-selection-fg);
}

.status-error {
  color: var(--exo-danger);
}

.status-warning {
  color: var(--exo-warning);
}

.status-success {
  color: var(--exo-success);
}
```

Avoid raw colors in component rules. If you need a shade, add one named token in
your own CSS and define it once per theme block; do not repeat a hex value in
every component.

## Native controls and scrollbars

`theme.css` sets `color-scheme` for each theme, so form controls, scrollbars and
the caret follow the mode. Add these where the browser supports them:

```css
html {
  accent-color: var(--exo-accent);
  scrollbar-color: var(--exo-border) var(--exo-bg);
}
```

A plugin that writes its own CSS instead of importing the sheet must declare the
equivalent `color-scheme` for each `data-theme` value.

## Before the handshake

There is a short interval before `followTheme` runs. The sheet follows
`prefers-color-scheme` while the document has no `data-theme` attribute, so a
light OS does not flash a dark page. Once the attribute is set it wins; do not
add a media query that overrides an explicit theme.

## Editor libraries

Monaco, CodeMirror and similar libraries own their syntax and selection colors.
Keep their theme model and map the shell value in `onTheme`:

```ts
function monacoTheme(theme: 'dark' | 'light' | 'high-contrast'): string {
  if (theme === 'light') return 'vs'
  if (theme === 'high-contrast') return 'hc-black'
  return 'vs-dark'
}

await followTheme(editor, {
  onTheme: (theme) => monaco.editor.setTheme(monacoTheme(theme)),
})
```

The SDK tokens style the page around the editor: notices, toolbars, status text
and empty or error states. The reference implementation is
[`apps/code-plugin/src/editor.ts`](../../apps/code-plugin/src/editor.ts) with
[`apps/code-plugin/src/editor.css`](../../apps/code-plugin/src/editor.css).

## If you already use `vscode-workbench`

The shell composes the public `vscode-workbench` package, and its
`vscode-workbench/styles/tokens.css` entry is a standalone token sheet. A plugin
that already renders `vscode-workbench` components may import it; the SDK helper
sets the same `data-theme` attribute its selectors read.

That is an optional existing path, not the plugin API: the package is `0.x`, has
peer dependencies and currently defines dark and light but not high contrast. For
a standalone plugin, prefer the small SDK sheet.

## Consistency rules

- Use the shell theme after the handshake, not `prefers-color-scheme`.
- Support `dark` and `light` at minimum; map `high-contrast` when you can.
- Give the page a background and foreground; transparent pages inherit the
  browser default and can become unreadable.
- Keep UI text at 4.5:1 and the focus ring at 3:1 against its adjacent surface.
  The SDK token pairs meet this in all three themes; overrides are your
  responsibility.
- Keep a visible `:focus-visible` indicator. Do not remove the outline without a
  replacement.
- Use `var(--exo-selection-bg)` and `var(--exo-selection-fg)` for selection.
- Honour `prefers-reduced-motion`; the shell's global rule does not cross the
  iframe boundary.
- Do not recreate shell chrome inside the iframe. Tabs, breadcrumbs, Save, the
  status bar and notices stay shell-owned; style the document content.
- A hidden handler has no visible surface and needs no palette.
- Check the layout at 200% zoom and with a keyboard-only path.

## Verify both themes

1. Open a matching file in the deployed shell.
2. Toggle the shell theme from the command palette or settings while the plugin
   is visible.
3. Confirm the page background, text, inputs, buttons, focus ring, selection and
   scrollbars follow without reopening the file.
4. Reload with the other theme active and confirm there is no lasting flash or
   stale palette.
5. If your editor library exposes a high-contrast theme, check that mapping too;
   the shell value is carried even when the settings UI only exposes dark and
   light.

A plugin that stays dark in the light theme usually has one of two causes: the
manifest lacks `events:subscribe`, or the CSS reads a fixed token instead of
`var(--exo-*)`.

Next: [hosting](./hosting.md), [testing](./testing.md) or the full token
contract in [`docs/contracts/plugin-styling.md`](../contracts/plugin-styling.md).
