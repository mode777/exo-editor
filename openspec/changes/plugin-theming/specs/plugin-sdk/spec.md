# Spec Delta

## ADDED Requirements

### Requirement: Theme helper exports

The SDK SHALL expose `@exo/plugin-sdk/theme` as a DOM-only entry point separate
from the DOM-free core and SHALL expose `theme.css` as a package style export,
and SHALL keep both additive within SDK major `1`.

#### Scenario: Core stays DOM-free

- **WHEN** `@exo/plugin-sdk` is imported outside a browser
- **THEN** the import neither loads the theme helper nor reads `document`, and
  the existing DOM-free guarantee is unchanged

#### Scenario: Theme entry point

- **WHEN** a plugin imports from `@exo/plugin-sdk/theme`
- **THEN** it receives `applyTheme` and `followTheme` with the documented
  signatures

#### Scenario: Stylesheet export

- **WHEN** a plugin imports `@exo/plugin-sdk/theme.css`
- **THEN** the SDK package export resolves the token stylesheet and the package's
  side-effect metadata preserves the CSS import in a production build

#### Scenario: Additive minor

- **WHEN** SDK `1.8.0` ships the theme exports
- **THEN** the protocol major remains `1`, the manifest schema remains `1`,
  existing SDK exports keep their behavior and no wire message changes

#### Scenario: Portable vendoring

- **WHEN** a plugin repository copies `packages/plugin-sdk` as its vendored SDK
- **THEN** the theme source, stylesheet and package exports are included and
  resolve without a build step or runtime dependency

## MODIFIED Requirements

### Requirement: DOM-independent typed core

The SDK SHALL expose the v1 protocol constants, envelope types, payload types and
message helpers from a core that performs no DOM access when imported, and SHALL
reach the browser only through an explicit adapter, the DOM-only theme helper or
an injected transport.

#### Scenario: Import outside a browser

- **WHEN** the package is imported in a non-browser runtime with no `window`,
  `document`, `location` or `parent`
- **THEN** the import succeeds and the protocol constants and envelope helpers are
  usable

#### Scenario: Browser adapter reads the fragment

- **WHEN** the browser adapter starts in a frame whose fragment contains
  `exo-host`, `exo-mode` and `exo-session`
- **THEN** it exposes those values as the host origin, mode and session id without
  requiring the plugin author to parse the fragment

#### Scenario: Injected transport drives a session

- **WHEN** a test supplies an injected transport instead of the browser adapter
- **THEN** the handshake, registration and editor clients operate without any DOM
  global
