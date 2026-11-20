# plugin-views Specification

## Purpose

Defines plugin-contributed panels and content views: how they are declared,
activated and mounted, how their frames are initialized and scoped, and how a
frame asks the shell to open a file, open another view or control a panel.

## Requirements

### Requirement: Panel contributions

The shell SHALL accept `contributes.panels` entries with `id`, `title`, optional `icon` (Codicon name), `location` of `primary` or `secondary`, and `entry` inside the plugin root. A primary panel SHALL add an activity-bar item and a left-panel view; a secondary panel SHALL add a right-panel view.

#### Scenario: Primary panel appears in the activity bar

- **WHEN** an active plugin registers a declared primary panel
- **THEN** the activity bar shows an item with the panel's icon and title, and activating it opens the panel in the primary side bar

#### Scenario: Secondary panel appears in the right panel

- **WHEN** an active plugin registers a declared secondary panel
- **THEN** the shell exposes it through the secondary-view picker and can show it in the secondary side bar

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

- **WHEN** a manifest declares more than eight panels
- **THEN** validation fails and none is registered

### Requirement: Panel registration and lazy mounting

A panel SHALL become visible only after its controller registers the declared id and the host activates the plugin. The shell SHALL mount a panel frame on its first reveal and SHALL retain it hidden, without disposal, while the panel is inactive. It SHALL dispose the frame on plugin removal, disable, revocation or workspace switch.

#### Scenario: Unregistered panel is not shown

- **WHEN** a manifest declares a panel but the controller never registers it
- **THEN** the activity bar or picker offers no entry for it

#### Scenario: First reveal mounts one frame

- **WHEN** the user first opens a registered panel
- **THEN** the shell mounts one view frame, completes the handshake and displays it over the panel placeholder

#### Scenario: Switch away hides without disposal

- **WHEN** the user switches to another primary or secondary view
- **THEN** the panel's iframe is hidden, no `shell/dispose` is sent, and the same frame is shown on return

#### Scenario: Closing the region hides without disposal

- **WHEN** the user closes the side bar containing a mounted panel and later reopens it
- **THEN** the frame is hidden and then shown again without a new handshake

#### Scenario: Never shown means never mounted

- **WHEN** a plugin registers a panel and the user never reveals it
- **THEN** no iframe is created for that panel

#### Scenario: Removal disposes the frame

- **WHEN** the plugin is disabled, removed or revoked
- **THEN** its panel frames are disposed and the activity bar or picker falls back to the remaining views

#### Scenario: Panel frame cap

- **WHEN** a plugin already has its declared panels mounted and the shell cannot mount another
- **THEN** the panel shows an explicit unavailable state and no extra frame is created

### Requirement: Content-view contributions and instances

The shell SHALL accept `contributes.contentViews` entries with `id`, `title` and `entry` inside the plugin root. A registered content view SHALL open as a read-only tab, one frame per open instance, with a 64 KiB JSON payload supplied at open time.

#### Scenario: Content view opens a tab

- **WHEN** an authorized frame or the shell palette opens a registered content view
- **THEN** the shell creates a tab, mounts one view frame, and passes the view id, title and optional payload in `shell/init`

#### Scenario: Content view is read-only

- **WHEN** a content-view frame is active
- **THEN** no dirty indicator, Save action or save round trip is offered for the tab

#### Scenario: Instance key reuses a tab

- **WHEN** `open-view` names an `instanceKey` that is already open
- **THEN** the shell activates the existing tab and ignores the new payload

#### Scenario: New instance key opens a new tab

- **WHEN** `open-view` names a new `instanceKey` or omits it
- **THEN** the shell opens a distinct tab and frame instance

#### Scenario: Content-view cap

- **WHEN** a plugin already has ten content-view tabs open and requests another
- **THEN** the shell returns `rate-limited` with a message and creates no tab

#### Scenario: Palette opens without a payload

- **WHEN** the user opens a content view from the shell's "Show View" palette
- **THEN** the tab opens with no payload and the view must render its empty state

#### Scenario: Closing a tab disposes

- **WHEN** the user closes a content-view tab
- **THEN** the shell sends `shell/dispose` with `closed` and drops the frame and tab

### Requirement: View frame initialization and capabilities

A view frame SHALL use the same handshake, sandbox, origin validation, settings, theme and dispose rules as a handler frame. `shell/init` SHALL carry `mode: "view"`, a `view` block and capabilities, and SHALL NOT carry a file block or file content.

#### Scenario: View handshake

- **WHEN** a view frame sends `plugin/ready` with the matching protocol major and session id
- **THEN** the shell replies with `shell/init` carrying `mode: "view"`, the plugin and workspace metadata, settings, theme, limits and the view block

#### Scenario: View block shape

- **WHEN** a panel is mounted
- **THEN** `view` carries `kind: "panel"`, the id, title, location and instance id and no payload

#### Scenario: Content-view block shape

- **WHEN** a content view is opened with a payload
- **THEN** `view` carries `kind: "content"`, the id, title, instance id and the payload, and `openedBy` when a plugin opened it

#### Scenario: No file metadata

- **WHEN** a view frame is initialized
- **THEN** the payload contains no `file` block, file path, bytes, `File`, `Blob` or handle

#### Scenario: Same sandbox rules

- **WHEN** a view frame is cross-origin or same-origin with the shell
- **THEN** it receives the same `allow-scripts allow-same-origin` or `allow-scripts` sandbox as a handler frame

#### Scenario: Settings are current

- **WHEN** a view frame mounts after a setting changed
- **THEN** `shell/init` carries the current resolved values for that plugin

### Requirement: Navigation and panel intents

A view or editor frame SHALL be able to ask the shell to open a workspace file, open a content view, or show/hide/toggle one of its plugin's panels. Each intent SHALL be a correlated request with a result, gated on the frame being active and visible, the declared permission and per-frame rate limits.

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

#### Scenario: Unknown panel

- **WHEN** a frame requests a panel that its plugin did not register
- **THEN** the shell replies `not-found` and changes no layout

#### Scenario: Hidden frame is denied

- **WHEN** a frame that is not visible or active asks to open a file, open a view or control a panel
- **THEN** the shell replies `permission-denied` and performs no action

#### Scenario: Intent rate limit

- **WHEN** a frame exceeds ten navigation or panel requests in a rolling second
- **THEN** the shell replies `rate-limited` and performs no further action for the excess

### Requirement: Cross-plugin content views

`plugin/open-view` SHALL accept an optional `pluginId`. When it is present the shell SHALL resolve the active plugin with that id and pass `openedBy` to the target; when it is absent the shell SHALL target the caller's own plugin. The payload SHALL be one-shot untrusted data and no reverse channel SHALL exist.

#### Scenario: Same-plugin open

- **WHEN** a panel omits `pluginId`
- **THEN** the shell only considers its own plugin's registered content views

#### Scenario: Cross-plugin open

- **WHEN** a frame names `pluginId` and a registered content view of that plugin
- **THEN** the shell opens the target's tab and passes `openedBy` with the caller's plugin id, name and origin

#### Scenario: Unknown target

- **WHEN** `pluginId` names no active plugin or the view id is not registered there
- **THEN** the shell replies `not-found` and opens no tab

#### Scenario: Unique active plugin id

- **WHEN** two entries in one workspace declare the same plugin id on one origin
- **THEN** the earlier declaration is the only active one, so `pluginId` resolves deterministically

#### Scenario: Payload is untrusted

- **WHEN** a cross-plugin open carries a payload
- **THEN** the target receives it as data, `openedBy` is advisory, and the caller receives no content or reply from the target

#### Scenario: No reverse channel

- **WHEN** plugin A opens plugin B's content view
- **THEN** A cannot subscribe to B's local events and B cannot address A's frames

### Requirement: View placement and shell-owned chrome

The shell SHALL derive the activity bar and both view registries from active registrations, SHALL show a primary panel through the activity bar, and SHALL expose secondary panels through shell-owned pickers. It SHALL keep titles, tabs, notices and plugin names in shell chrome and SHALL position a frame only over a shell-owned placeholder.

#### Scenario: Activity bar is derived

- **WHEN** the active plugins change
- **THEN** the activity bar shows the explorer first and then the active primary panels in declaration and registration order

#### Scenario: Secondary view picker

- **WHEN** more than one secondary panel is registered
- **THEN** the user can switch between them through the shell's "Show View" palette entries and the secondary header action

#### Scenario: Plugin name is visible

- **WHEN** a panel, content view or secondary picker entry is rendered
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

- **WHEN** the active primary or secondary panel is unregistered
- **THEN** the shell falls back to the explorer or the next available secondary view

### Requirement: View lifecycle and failure isolation

The shell SHALL surface a view failure inside the panel or tab, keep other views and documents usable, dispose frames and close content tabs on plugin removal or workspace switch, and SHALL never present an empty or stale surface as live plugin content.

#### Scenario: Panel failure

- **WHEN** a panel frame fails to load, times out or violates the protocol
- **THEN** the panel shows an error state with a retry action, the activity item remains, and other views keep working

#### Scenario: Content-view failure

- **WHEN** a content-view frame fails
- **THEN** the tab shows an error state with retry and close actions and no empty content

#### Scenario: Plugin removal

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** its panels and content-view tabs are closed and its frames are disposed

#### Scenario: Workspace switch

- **WHEN** the user switches workspaces
- **THEN** every panel and content-view frame is disposed and no tab from the old workspace remains

#### Scenario: Late message

- **WHEN** a message arrives from a disposed view frame
- **THEN** the shell drops it and does not recreate state

#### Scenario: Log excludes content

- **WHEN** a view failure or intent is logged
- **THEN** the entry carries ids, view ids, phase and error code only, never a payload or file content
