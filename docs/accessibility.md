# Accessibility

Status: automated checks pass and the Exo-owned surfaces were reviewed for the
`release-readiness` change. The deployed keyboard/screen-reader smoke result is
recorded in [Deployed verification](#deployed-verification) after task 8.4.

## Scope

Exo owns these surfaces and checks them:

- explorer (toolbar, tree, banners, context menu, inline rename)
- document area (text editor, plugin frame surface, banners, actions)
- settings dialog, including plugin settings, raw `exo.json` and the plugin log
- consent dialog
- unsaved-changes dialog
- remote-connect dialog and the reconnect banner

The reused `vscode-workbench` chrome is explicitly out of scope for patching:
title bar, activity bar, tabs, bottom panel, status bar and command palette. Exo
composes the package and does not fork it; upstream limitations are recorded
below.

## Automated checks

Run:

```bash
npm test --workspace @exo/shell -- --run \
  src/a11y.test.tsx \
  src/accessibility-contrast.test.ts \
  src/components/useModalDialog.test.tsx
```

- `src/a11y.test.tsx` renders each Exo-owned surface and runs `axe-core` 4.14.1
  with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` tags.
  Result on 2026-11-16: 8 tests pass, no violation on an Exo-owned node.
- `src/accessibility-contrast.test.ts` parses the dark and light palettes from
  the pinned `vscode-workbench/dist/styles/tokens.css` and checks the pairs Exo
  actually uses: text at 4.5:1 and focus indicators at 3:1. Result: 5 tests pass
  in both themes. A synthetic low-contrast pair is included so a broken checker
  fails the suite.
- `src/components/useModalDialog.test.tsx` covers initial focus, Tab and
  Shift+Tab wrap, Escape and focus restoration for the shared modal hook used by
  the consent, settings, close-prompt and remote-connect dialogs.

`axe-core` cannot evaluate `color-contrast` in jsdom (no layout or canvas), so
that rule is disabled in the test helper and covered by the token test instead.
The manual check below is still authoritative for rendered contrast.

## Upstream exceptions

| Surface | Why it is excluded | Owner |
| --- | --- | --- |
| Title bar, activity bar, tabs, bottom panel, status bar | Rendered by `vscode-workbench@~0.1.3`; Exo composes props and must not fork | upstream package |
| Command palette dialog | Upstream quick-open component; Exo supplies entries only | upstream package |
| Focus order through the workbench chrome | Upstream layout owns the landmark and tab order | upstream package |
| Monaco editor internals | Third-party plugin content inside a sandboxed iframe | `apps/code-plugin` |

No excluded node is asserted to be conformant. If an upstream surface blocks a
release check, it is raised upstream and recorded here rather than patched in a
vendored copy.

## Manual keyboard and screen-reader script

Run against the deployed URL with the demo workspace from
`examples/demo-workspace/`:

1. Load the page, press Tab repeatedly from the address bar. Focus reaches the
   activity bar, explorer, tabs, document area and status bar in a visible order;
   no region traps focus.
2. In the explorer, use Arrow Up/Down to move, Arrow Right/Left to expand and
   collapse, Home/End to jump, Enter to open, F2 to rename and Delete to prompt.
   Focus stays on a valid row after each change.
3. Open a file, press Tab into the editor, type, press Ctrl/Cmd+S. The tab dirty
   dot clears and focus does not jump out of the editor.
4. Open Settings from the palette. Focus enters the dialog, Tab and Shift+Tab
   cycle inside it, Escape closes it and focus returns to the status-bar control
   or palette entry that opened it.
5. Repeat the focus trap and Escape check for the consent dialog, the
   unsaved-changes prompt and the remote-connect dialog.
6. Deny a plugin consent. The plugin entry reports the decision and no second
   alert repeats it.
7. Open a read-only workspace. The read-only banner is announced once; Retry and
   Restore access remain reachable by keyboard.
8. Toggle the theme. Both themes keep text, hint text, disabled text and focus
   rings readable; the tree focus ring remains visible on a selected row.
9. With a screen reader (VoiceOver on macOS, NVDA on Windows), repeat steps 2-4
   and confirm the tree announces name, level, expanded and selected state, and
   dialogs announce their title and initial control.

## Known limitations

- Automated checks run in jsdom without layout, so rendered clipping, overlap
  and real contrast are manual.
- Screen-reader verification is a release checklist item, not a CI gate; the
  browser/assistive-technology combination is recorded with the result.
- Plugin-rendered content is untrusted third-party UI in an iframe and is not
  covered by the shell's a11y guarantees.
- The visible handler frame is `aria-hidden` while hidden and focusable when
  shown; keyboard interaction inside it belongs to the plugin.
- Mobile and touch-only layouts are out of scope for v1.

## Deployed verification

Run on 2026-11-16 against deployed commit `90172af`
(`https://mode777.github.io/exo-editor/`) with Chrome for Testing
131.0.6778.264 at 1280x800, using the demo workspace on an OPFS handle and the
same `showDirectoryPicker` stub as the layer 5-9 verification.

- Consent dialog: focus starts on Deny; Tab reaches Allow plugin and the plugin
  homepage link; the next Tab wraps to Deny. Escape closes the Exo Code dialog
  and the next consent prompt appears in order. Result: pass.
- Settings dialog: focus enters the dialog, twelve Tab presses stay inside it,
  and Escape closes it. Result: pass.
- The automated axe and contrast suites above pass in the same run; the shell's
  keyboard navigation through the explorer, tabs, document area and status bar
  matched the script.
- Screen reader: no VoiceOver or NVDA host was available on the verification
  server, so that step is not run. It remains a human release checklist item
  and is not claimed as verified. Keyboard-only traversal, focus traps and
  programmatic semantics are the recorded evidence.
