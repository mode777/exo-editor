# Demo workspace

Open this folder in the deployed shell at
`https://mode777.github.io/exo-editor/`. It declares the two deployed reference
plugins and gives you one file for each editor path.

## Expected observations

1. Two consent prompts appear, in declaration order: **Exo Code** and then
   **Exo Template**. Both are same-origin child paths, so each shows the
   same-origin warning; Exo Code also shows the frame-rendering disclosure.
2. `hello.ts`, `data.json` and `notes.md` open in **Exo Code**, a visible Monaco
   surface. Edit one, press Ctrl/Cmd+S or run File > Save, and the file
   round-trips.
3. `greeting.template.txt` opens in the hidden **Exo Template** editor. Editing
   and saving appends a `[template save N]` marker.
4. `plain.txt` opens in the shell's own text surface: this file has no plugin
   editor.
5. `draft.md` is for the unsaved-changes check: edit it, then close the tab. The
   shell offers Save, Discard and Cancel.
6. Toggling the shell theme changes the Monaco theme without reopening the file.
7. Disabling a plugin in settings makes its files fall back to the shell text
   surface and removes the frame.
8. Switching to another workspace and back leaves no tab, frame, handler or log
   entry from the previous visit.

The recorded path with screenshots is in
[`docs/walkthrough.md`](../../docs/walkthrough.md).

## Permissions

Exo Code asks for `workspace:read`, `workspace:write` and `events:subscribe`.
Exo Template asks for `workspace:read` and `workspace:write`. Neither needs
storage in same-origin mode.
