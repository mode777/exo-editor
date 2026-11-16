# Spec Delta

## ADDED Requirements

### Requirement: Visible handler frame surface

When the selected contribution declares `rendering: "frame"`, the shell SHALL
display its handler iframe in the measured document area for the active
document, SHALL keep the tab strip, document header, Save action and shell
notices outside the frame, and SHALL hide the frame when another tab is active
without disposing the handler session. The shell SHALL NOT give the plugin a
shell DOM node, reparent the live iframe or create a second handler for the same
document.

#### Scenario: Frame appears for the active document

- **WHEN** a document handled by a `rendering: "frame"` contribution becomes the
  active tab
- **THEN** its handler iframe is visible inside the document area and the shell's
  header and Save button remain outside it

#### Scenario: Tab switch hides without disposal

- **WHEN** the user switches to another tab and back
- **THEN** the first document's iframe is hidden while inactive, no
  `shell/dispose` is sent, and the same handler session is visible again on return

#### Scenario: Shell chrome stays outside

- **WHEN** a visible plugin frame is displayed
- **THEN** the tab, breadcrumbs, file size, editor label, Save action, read-only
  notice and external-change banners are rendered by the shell and are not part
  of the plugin document

#### Scenario: Frame failure hides the surface

- **WHEN** a visible handler fails to load, times out or violates the protocol
- **THEN** the shell removes the frame surface and shows its normal failure or
  text fallback state

#### Scenario: Hidden contributions are unchanged

- **WHEN** a contribution omits `rendering` or declares `rendering: "hidden"`
- **THEN** its handler stays out of the document area and the existing headless
  behavior is unchanged

#### Scenario: No shell DOM access

- **WHEN** a visible handler runs
- **THEN** it can render only inside its own iframe and receives no shell element,
  `FileSystemHandle`, `File`, `Blob` or synchronous callback
