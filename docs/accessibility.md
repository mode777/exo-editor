# Accessibility

Status: automated checks pass and the Exo-owned surfaces were reviewed for the
`release-readiness` change. The deployed keyboard/screen-reader smoke result is
recorded in [Deployed verification](#deployed-verification) after task 8.4.

## Scope

Exo owns these surfaces and checks them:

- explorer (workspace header and its actions, tree, banners, context menu, inline rename)
- document area (text editor, plugin frame surface, content-view chrome and placeholder, banners, actions)
- plugin panels (side-bar header action, bottom tab strip and shell-owned placeholder)
- secondary-view picker
- extensions view (search, Installed and Marketplace sections, rows, install/manage actions, feed errors)
- extension details tab (metadata, permissions, status, consent actions, contributed settings)
- settings dialog, including raw `exo.json` and the plugin log
- consent dialog
- workspace file picker (shell-owned plugin selection dialog)
- new-file Save As dialog
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
  src/components/useModalDialog.test.tsx \
  src/extensions/ExtensionsView.test.tsx
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
  the consent, settings, close-prompt, remote-connect, file-picker and new-file
  dialogs.
- `src/document/FilePickerDialog.test.tsx` covers the picker's initial focus,
  arrow-key row navigation, Escape cancellation, bidi-isolated paths and
  reserved-entry filtering.
- `src/document/NewFileDialog.test.tsx` covers the Save As dialog's initial focus
  on the name field, plugin disclosure, path and size, text preview, binary
  label, folder navigation, reserved-folder filtering and the collision state.
- `src/workbench/SecondaryViewPicker.test.tsx` covers the secondary-view picker's
  list, initial focus, Arrow Up/Down movement, Escape close and an axe scan.
- `src/extensions/ExtensionsView.test.tsx` covers the labelled search, both
  sections, catalog/installed rows, install-by-URL validation, the no-workspace
  and read-only disabled states, failed-source isolation, the details tab, the
  contributed settings fieldset and axe scans of both the view and details.
- `src/document/ContentViewSurface.test.tsx` covers the content-view body, the
  absence of a second header or breadcrumb row, the placeholder accessible name
  and an axe scan of the shell-owned nodes.
- `src/document/DocumentArea.commands.test.tsx` covers the plugin action row:
  the matching plugin's commands only, an accessible name that includes the
  plugin, and an axe scan. `src/explorer/ExplorerView.commands.test.tsx` covers
  the explorer context menu, plugin attribution, the ten-entry cap, Escape and
  an axe scan. `src/workbench/CommandNotices.test.tsx` covers the bounded
  plain-text notice, manual dismissal and auto-dismiss.

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
   A single click expands or collapses a folder and the workspace twisty hides or
   shows the whole tree; the header actions are New File, New Folder, Refresh
   Explorer and Collapse Folders in Explorer. Focus stays on a valid row after
   each change.
3. Open a file, press Tab into the editor, type, press Ctrl/Cmd+S. The tab dirty
   dot clears and focus does not jump out of the editor.
4. Open Settings from the palette. Focus enters the dialog, Tab and Shift+Tab
   cycle inside it, Escape closes it and focus returns to the status-bar control
   or palette entry that opened it.
5. Repeat the focus trap and Escape check for the consent dialog, the
   unsaved-changes prompt, the remote-connect dialog, the plugin file picker and
   the new-file Save As dialog. In the picker, use Arrow Up/Down and Home/End
   between rows, Enter to open a folder or select a file, and Escape to cancel;
   focus returns to the plugin frame. In the Save As dialog, focus starts in the
   name field, the folder buttons and name are Tab-reachable, the final path and
   size are readable, and Escape cancels without writing.
6. Deny a plugin consent. The plugin entry reports the decision and no second
   alert repeats it.
7. Open a read-only workspace. The read-only banner is announced once; Retry and
   Restore access remain reachable by keyboard, and the header's New File and New
   Folder actions are disabled while Refresh Explorer stays available.
8. Toggle the theme. Both themes keep text, hint text, disabled text and focus
   rings readable; the tree focus ring remains visible on a selected row.
9. With a screen reader (VoiceOver on macOS, NVDA on Windows), repeat steps 2-4
   and confirm the tree announces name, level, expanded and selected state, and
   dialogs announce their title and initial control.
10. With the deployed fixture active, open a `*.txt` file. Tab reaches the
    document action row; the button name includes the command and the plugin.
    Run it with Enter and confirm focus stays in the document area and no notice
    appears. Open the explorer context menu with the keyboard (Context Menu key or
    Shift+F10), use Arrow Up/Down between entries, Escape to close without
    invoking, and run an explorer command; confirm the menu names the plugin.
    Run the failing command from the palette and confirm the `role="status"`
    notice is announced, the Dismiss button is reachable and the notice also
    disappears after the timeout. At 200% zoom, the action row wraps without
    clipping and the palette, menu and toolbar remain keyboard reachable.
11. With the fixture active, open a `*.bound.txt` file and the bottom region.
    Tab to the **Fixture Inspection** tab and switch between bottom tabs with
    the keyboard; the placeholder region announces the panel and plugin name,
    and an inactive tab creates no iframe. Use the panel's snapshot/edit/undo
    buttons with the keyboard; focus stays in the panel and the editor tab
    reports dirty. Close and reopen the region and confirm focus returns to a
    reachable control.
12. Open Extensions from the activity bar or `Ctrl+Shift+X`. Focus reaches the
    search field, the Installed and Marketplace section toggles report their
    expanded state, and Tab moves through row title/manage/install actions
    without entering an iframe. Type a query and confirm both sections filter
    with a visible empty result. Open an installed extension's details; the tab
    heading names the extension, the permissions and settings are readable, and
    the Disable/Remove/Review actions are keyboard reachable. Repeat in both
    themes and at a narrow width; focus rings remain visible and no control is
    clipped. With a feed error, confirm the error is announced and the Retry
    button is reachable while installed rows still work. With no workspace, the
    install actions are disabled and the explanation is announced.

## Known limitations

- Automated checks run in jsdom without layout, so rendered clipping, overlap
  and real contrast are manual.
- Screen-reader verification is a release checklist item, not a CI gate; the
  browser/assistive-technology combination is recorded with the result.
- Plugin-rendered content is untrusted third-party UI in an iframe and is not
  covered by the shell's a11y guarantees.
- The visible handler frame is `aria-hidden` while hidden and focusable when
  shown; keyboard interaction inside it belongs to the plugin.
- A panel or content-view iframe is positioned over a shell-owned placeholder
  with an accessible region name. The frame's internal focus order and content
  belong to the plugin; only the placeholder, titles, tabs and controls are
  Exo-owned. The bottom tab strip is upstream chrome; Exo supplies the tab
  titles, plugin names and placeholder names and does not patch its keyboard
  model.
- The activity bar is upstream chrome; Exo supplies panel items and includes the
  plugin name in their titles, but does not patch its keyboard model.
- The upstream command palette and its keyboard model are excluded from the
  shell's automated scans; the plugin command entries it renders are shell-owned
  and attributable, and the manual script covers the palette path.
- Mobile and touch-only layouts are out of scope for v1.

## Deployed verification

Run on 2026-11-16 against deployed commit `90172af`
(`https://mode777.github.io/exo-editor/`) with Chrome for Testing
131.0.6778.264 at 1280x800, using the demo workspace on an OPFS handle and the
same `showDirectoryPicker` stub as the layer 5-9 verification. The plugin view
surface checks below were repeated on 2026-11-20 against commit `3f69504`.

- Consent dialog: focus starts on Deny; Tab reaches Allow plugin and the plugin
  homepage link; the next Tab wraps to Deny. Escape closes the Exo Code dialog
  and the next consent prompt appears in order. Result: pass.
- File picker (added 2026-11-18 at commit `a868f08`): the dialog opened from the
  visible fixture, focus entered the dialog, Arrow Down moved between rows,
  Escape closed it and the fixture recorded an empty selection. Result: pass.
- New-file Save As dialog (added 2026-11-20 at commit `bc8270a`): the dialog
  opened from the explorer and the generator view, focus started in the name
  field, folder buttons and the name were keyboard reachable, the path and size
  were announced, the text preview and binary label were present, and Escape
  cancelled without writing. Result: pass. The axe suite also covers the
  rendered dialog.
- Plugin view surfaces (added 2026-11-20 at commit `3f69504`): the activity item
  was named `Fixture Panel — Exo Host Fixture`; the secondary "Select View"
  action opened the picker, both options named their plugin, focus entered the
  first option, Arrow Down moved to the second and Escape closed it; the
  content-view placeholder exposed a region name and the tab named the plugin.
  Result: pass.
- Settings dialog: focus enters the dialog, twelve Tab presses stay inside it,
  and Escape closes it. Result: pass.
- Extensions view and details (added 2026-11-27 at commit `badc141`): the
  automated axe scans pass; the deployed checks opened the view from the
  activity bar, filtered both sections, opened and read details, installed and
  approved a plugin, disabled and removed it, and confirmed the settings debug
  surface. The view rendered in dark and light and remained usable at 900x700
  with no horizontal body scroll. Missing-source, invalid-feed and invalid
  `exo.json` states announced their errors and kept the applicable actions
  reachable. Result: pass. A full screen-reader pass remains a human checklist
  item, as with the rest of the shell.
- The automated axe and contrast suites above pass in the same run; the shell's
  keyboard navigation through the explorer, tabs, document area and status bar
  matched the script.
- Screen reader: no VoiceOver or NVDA host was available on the verification
  server, so that step is not run. It remains a human release checklist item
  and is not claimed as verified. Keyboard-only traversal, focus traps and
  programmatic semantics are the recorded evidence.
