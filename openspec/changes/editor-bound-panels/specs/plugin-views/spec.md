# Spec Delta

## Purpose

Defines plugin-contributed panels and content views: how they are declared,
activated and mounted, how their frames are initialized and scoped, and how a
frame asks the shell to open a file, open another view or control a panel. This
delta adds the bottom panel location and the active-editor context a view frame
can use to follow a file editor without gaining file or write authority.

## MODIFIED Requirements

### Requirement: Panel contributions

The shell SHALL accept `contributes.panels` entries with `id`, `title`, optional `icon` (Codicon name), `location` of `primary`, `secondary` or `bottom`, and `entry` inside the plugin root. A primary panel SHALL add an activity-bar item and a left-panel view; a secondary panel SHALL add a right-panel view; a bottom panel SHALL add a tab in the shell's bottom region. The panel limit SHALL remain eight across all locations.

#### Scenario: Primary panel appears in the activity bar

- **WHEN** an active plugin registers a declared primary panel
- **THEN** the activity bar shows an item with the panel's icon and title, and activating it opens the panel in the primary side bar

#### Scenario: Secondary panel appears in the right panel

- **WHEN** an active plugin registers a declared secondary panel
- **THEN** the shell exposes it through the secondary-view picker and can show it in the secondary side bar

#### Scenario: Bottom panel appears as a tab

- **WHEN** an active plugin registers a declared bottom panel
- **THEN** the bottom region becomes available and shows that panel as a tab, without adding an activity-bar item or a secondary-view picker entry

#### Scenario: Multiple bottom panels share the region

- **WHEN** two active plugins each register a bottom panel
- **THEN** both appear as tabs in the same bottom region and the active tab is the only mounted bottom-panel frame

#### Scenario: Icon is a Codicon name

- **WHEN** a panel declares `icon: "list-tree"`
- **THEN** the shell renders that Codicon and falls back to a default icon for an unknown name without failing the manifest

#### Scenario: Entry stays inside the root

- **WHEN** a panel entry resolves outside the plugin root or to another origin
- **THEN** validation rejects the manifest before any frame is created

#### Scenario: Duplicate panel id

- **WHEN** a manifest declares two panels with the same id
- **THEN** validation fails with `invalid-manifest` and no panel is registered

#### Scenario: Panel limit

- **WHEN** a manifest declares more than eight panels across primary, secondary and bottom locations
- **THEN** validation fails and none is registered

### Requirement: Panel registration and lazy mounting

A panel SHALL become visible only after its controller registers the declared id and the host activates the plugin. The shell SHALL mount a panel frame on its first reveal and SHALL retain it hidden, without disposal, while the panel is inactive. A bottom panel SHALL mount when its tab becomes the active bottom tab, not when another bottom tab is active. The shell SHALL dispose the frame on plugin removal, disable, revocation or workspace switch.

#### Scenario: Unregistered panel is not shown

- **WHEN** a manifest declares a panel but the controller never registers it
- **THEN** the activity bar, picker or bottom region offers no entry for it

#### Scenario: First reveal mounts one frame

- **WHEN** the user first opens a registered panel
- **THEN** the shell mounts one view frame, completes the handshake and displays it over the panel placeholder

#### Scenario: Switch away hides without disposal

- **WHEN** the user switches to another primary, secondary or bottom view
- **THEN** the panel's iframe is hidden, no `shell/dispose` is sent, and the same frame is shown on return

#### Scenario: Closing the region hides without disposal

- **WHEN** the user closes the side bar or bottom region containing a mounted panel and later reopens it
- **THEN** the frame is hidden and then shown again without a new handshake

#### Scenario: Inactive bottom tab stays unmounted

- **WHEN** the bottom region shows a second bottom panel while the first bottom tab is active
- **THEN** the inactive panel creates no iframe until its tab becomes active

#### Scenario: Never shown means never mounted

- **WHEN** a plugin registers a panel and the user never reveals it
- **THEN** no iframe is created for that panel

#### Scenario: Removal disposes the frame

- **WHEN** the plugin is disabled, removed or revoked
- **THEN** its panel frames are disposed and the activity bar, picker or bottom region falls back to the remaining views

#### Scenario: Panel frame cap

- **WHEN** a plugin already has its declared panels mounted and the shell cannot mount another
- **THEN** the panel shows an explicit unavailable state and no extra frame is created

### Requirement: View frame initialization and capabilities

A view frame SHALL use the same handshake, sandbox, origin validation, settings, theme and dispose rules as a handler frame. `shell/init` SHALL carry `mode: "view"`, a `view` block, an `activeEditor` field and capabilities, and SHALL NOT carry a file block or file content.

#### Scenario: View handshake

- **WHEN** a view frame sends `plugin/ready` with the matching protocol major and session id
- **THEN** the shell replies with `shell/init` carrying `mode: "view"`, the plugin and workspace metadata, settings, theme, limits, the view block and the active-editor context

#### Scenario: View block shape

- **WHEN** a panel is mounted
- **THEN** `view` carries `kind: "panel"`, the id, title, location (`primary`, `secondary` or `bottom`) and instance id and no payload

#### Scenario: Bottom panel block shape

- **WHEN** a bottom panel frame is initialized
- **THEN** `view.location` is `"bottom"` and the frame receives no payload

#### Scenario: Content-view block shape

- **WHEN** a content view is opened with a payload
- **THEN** `view` carries `kind: "content"`, the id, title, instance id and the payload, and `openedBy` when a plugin opened it

#### Scenario: No file metadata

- **WHEN** a view frame is initialized
- **THEN** the payload contains no `file` block, file content, bytes, `File`, `Blob` or handle; `activeEditor.path` is metadata only

#### Scenario: Same sandbox rules

- **WHEN** a view frame is cross-origin or same-origin with the shell
- **THEN** it receives the same `allow-scripts allow-same-origin` or `allow-scripts` sandbox as a handler frame

#### Scenario: Settings are current

- **WHEN** a view frame mounts after a setting changed
- **THEN** `shell/init` carries the current resolved values for that plugin

### Requirement: Navigation and panel intents

A view or editor frame SHALL be able to ask the shell to open a workspace file, open a content view, or show/hide/toggle one of its plugin's panels. Each intent SHALL be a correlated request with a result, gated on the frame being active and visible, the declared permission and per-frame rate limits. A panel request SHALL resolve the panel's manifest location, including `bottom`, and SHALL leave the message shape unchanged.

#### Scenario: Open a file

- **WHEN** an active view frame with `workspace:read` sends `plugin/open-file` with a valid workspace path
- **THEN** the shell opens or activates that file's tab and replies with a successful `shell/open-result`

#### Scenario: Relative path from an editor

- **WHEN** an editor frame of `/src/editor.ts` asks to open `./types.ts`
- **THEN** the shell resolves `/src/types.ts` and opens it

#### Scenario: View paths are absolute

- **WHEN** a view frame asks to open `types.ts` without a leading slash
- **THEN** the shell rejects it with `permission-denied` and opens nothing

#### Scenario: Reserved path

- **WHEN** any frame asks to open `/exo.json` or a path under `/.exo/`
- **THEN** the shell replies `permission-denied` and opens no tab

#### Scenario: Open without read permission

- **WHEN** a frame whose plugin lacks `workspace:read` asks to open a file
- **THEN** the shell replies `permission-denied` and performs no read

#### Scenario: Missing file or directory

- **WHEN** the requested path is missing or is a directory
- **THEN** the shell replies `not-found` or `not-a-file` and opens no tab

#### Scenario: Open a content view

- **WHEN** an active frame sends `plugin/open-view` for a registered view
- **THEN** the shell opens the tab and replies with a successful `shell/open-result`

#### Scenario: Request a panel

- **WHEN** an active frame sends `plugin/request-panel` for its own registered panel with `show`, `hide` or `toggle`
- **THEN** the shell changes the layout and replies with `shell/panel-result` carrying the panel id and its resulting open state

#### Scenario: Request a bottom panel

- **WHEN** an active frame sends `plugin/request-panel` for its own registered bottom panel
- **THEN** the shell shows, hides or toggles the bottom region, makes that panel the active bottom tab for a show or an opening toggle, and replies with the resulting open state

#### Scenario: Unknown panel

- **WHEN** a frame requests a panel that its plugin did not register
- **THEN** the shell replies `not-found` and changes no layout

#### Scenario: Hidden frame is denied

- **WHEN** a frame that is not visible or active asks to open a file, open a view or control a panel
- **THEN** the shell replies `permission-denied` and performs no action

#### Scenario: Intent rate limit

- **WHEN** a frame exceeds ten navigation or panel requests in a rolling second
- **THEN** the shell replies `rate-limited` and performs no further action for the excess

### Requirement: View placement and shell-owned chrome

The shell SHALL derive the activity bar and all three view registries from active registrations, SHALL show a primary panel through the activity bar, SHALL expose secondary panels through shell-owned pickers, and SHALL expose bottom panels as shell-owned tabs. It SHALL keep titles, tabs, notices and plugin names in shell chrome and SHALL position a frame only over a shell-owned placeholder.

#### Scenario: Activity bar is derived

- **WHEN** the active plugins change
- **THEN** the activity bar shows the explorer first and then the active primary panels in declaration and registration order

#### Scenario: Secondary view picker

- **WHEN** more than one secondary panel is registered
- **THEN** the user can switch between them through the shell's "Show View" palette entries and the secondary header action

#### Scenario: Bottom region is derived

- **WHEN** the active plugins change
- **THEN** the bottom region shows exactly the registered bottom panels in declaration and registration order, and disables itself when none remains

#### Scenario: Plugin name is visible

- **WHEN** a panel, content view, secondary picker entry or bottom tab is rendered
- **THEN** the shell chrome names the plugin so a newly added surface cannot impersonate shell chrome

#### Scenario: Content tab chrome

- **WHEN** a content view is active
- **THEN** the tab, close control and any notice are shell-owned and the iframe renders only inside the document body area

#### Scenario: No shell DOM

- **WHEN** a panel or content-view frame runs
- **THEN** it receives no shell element, `FileSystemHandle`, `File`, `Blob` or synchronous shell callback

#### Scenario: Surface bounds come from the shell

- **WHEN** a panel or content view is resized, hidden or revealed
- **THEN** the shell measures its own placeholder and positions the iframe, and the plugin cannot move or overlay the frame itself

#### Scenario: Active view disappears

- **WHEN** the active primary, secondary or bottom panel is unregistered
- **THEN** the shell falls back to the explorer, the next available secondary view or the first remaining bottom tab

## ADDED Requirements

### Requirement: Active editor context for view frames

The shell SHALL include `activeEditor` (`{ pluginId, path, instanceId }` or `null`) in a view frame's `shell/init`, limited to the frame's plugin identity, and SHALL publish the targeted `editor/active` topic when it changes. The field SHALL be metadata only. No frame-to-frame message API is added; panels and editors SHALL use the existing `local/*` events, and the editor SHALL remain the only owner of the document, history, dirty state and save flow.

#### Scenario: Panel starts with an active editor

- **WHEN** a panel frame mounts while the active tab is a file handled by an active editor of the same plugin
- **THEN** `shell/init.activeEditor` carries that plugin id, workspace path and editor instance id

#### Scenario: Editor receives its instance id

- **WHEN** an editor frame completes its handshake
- **THEN** `shell/init.editor.instanceId` is present and equals the value later advertised for that frame in `activeEditor` and `editor/active`

#### Scenario: Another plugin's editor is not exposed

- **WHEN** the active tab is a file handled by another plugin's editor
- **THEN** the view's `activeEditor` is `null` and the other plugin's `editor/active` is not delivered to this plugin

#### Scenario: Same manifest id on another origin is not exposed

- **WHEN** two plugins with the same manifest id run on different origins and one has an active editor
- **THEN** the other plugin's views receive `activeEditor: null` because identity includes the origin

#### Scenario: Non-editor surfaces clear the context

- **WHEN** the active tab is a shell text file, a content view or no tab
- **THEN** the view's `activeEditor` is `null`

#### Scenario: Active editor changes

- **WHEN** the active tab moves to another file handled by the same plugin
- **THEN** the subscribed views receive `editor/active` with `active: true` and the new path and instance id

#### Scenario: Active editor clears

- **WHEN** the active tab moves to a shell text file, a content view, another plugin's editor or no tab
- **THEN** the subscribed views receive `editor/active` with `active: false`

#### Scenario: Metadata only

- **WHEN** a view receives `activeEditor` or `editor/active`
- **THEN** it receives no file content, bytes, `File`, `Blob`, handle or save path

#### Scenario: Panel and editor exchange local events

- **WHEN** a panel publishes a `local/*` event whose payload names the active editor's instance id
- **THEN** the shell delivers it only to the plugin's subscribed frames, the matching editor may apply an edit through its own history, and its reply carries its own instance id in `from`

#### Scenario: View frame has no save path

- **WHEN** a view frame sends `plugin/dirty`, `plugin/request-save` or `plugin/save-content`
- **THEN** the shell treats it as a protocol violation and the editor remains the only writer
