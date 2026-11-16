# Spec Delta

## MODIFIED Requirements

### Requirement: Bootstrap and handshake

The shell SHALL mount registration frames hidden, SHALL mount handler frames
hidden unless the approved contribution declares `rendering: "frame"`, in which
case the active document's handler frame is displayed in the document area, and
SHALL allow no top navigation, popups, modals, downloads or fullscreen in either
case. Every frame SHALL use `referrerpolicy="no-referrer"`, SHALL apply
`sandbox="allow-scripts allow-same-origin"` to cross-origin plugin origins and
`sandbox="allow-scripts"` to plugin origins equal to the shell origin, SHALL pass
the shell origin and session id in the URL fragment, SHALL send `shell/init` only
after receiving a valid `plugin/ready`, and SHALL include in `shell/init` the
plugin's resolved workspace-scoped settings values for both registration and
editor modes.

#### Scenario: Ready starts the session

- **WHEN** a plugin frame sends `plugin/ready` with a supported protocol version
- **THEN** the shell replies with `shell/init` containing the mode, session id, plugin identity, shell version and origin, workspace name, theme, permissions, locale and the plugin's current settings values

#### Scenario: Settings values are initialized

- **WHEN** a plugin declares workspace settings and a handler or registration
  frame sends `plugin/ready`
- **THEN** `shell/init` carries the resolved values for that plugin, including
  declared defaults for settings with no stored value

#### Scenario: No settings means an empty map

- **WHEN** a plugin declares no configuration
- **THEN** `shell/init` carries an empty settings object rather than omitting the
  field or inventing values

#### Scenario: Same-origin plugin gets the stricter sandbox

- **WHEN** a plugin is served from the shell origin
- **THEN** its iframe is created with `sandbox="allow-scripts"` and no `allow-same-origin`, so it has an opaque origin, no storage and no parent DOM access

#### Scenario: Ready timeout

- **WHEN** `plugin/ready` does not arrive within 10 seconds of mounting
- **THEN** the shell reports `timeout` naming the plugin and phase, removes the iframe and rolls back any partial state

#### Scenario: Protocol major mismatch

- **WHEN** a plugin reports a protocol major the shell does not support
- **THEN** the shell replies with `unsupported-version`, mounts nothing further and unloads the frame

#### Scenario: Ready from the wrong source

- **WHEN** a message shaped like `plugin/ready` arrives from the expected origin but not from the mounted frame's window
- **THEN** it is dropped and counts toward the frame's protocol-violation budget

#### Scenario: Frame fails to load

- **WHEN** the iframe fires `error` or the document never loads
- **THEN** the shell reports `loading-failed`, removes the frame and rolls back partial state

#### Scenario: Repeated origin violations

- **WHEN** a frame sends three messages from the wrong origin
- **THEN** the shell removes it with `protocol-violation`

#### Scenario: Registration frame stays hidden

- **WHEN** a plugin controller performs the registration phase
- **THEN** its iframe is never displayed in the document area even if its
  contributions declare `rendering: "frame"`

#### Scenario: Visible handler frame keeps its sandbox

- **WHEN** a same-origin contribution declares `rendering: "frame"` and its
  handler is displayed
- **THEN** the iframe still uses `sandbox="allow-scripts"` and the visibility
  change adds no storage, popup, navigation or parent access
