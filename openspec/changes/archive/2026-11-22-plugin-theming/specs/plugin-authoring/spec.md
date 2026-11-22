# Spec Delta

## ADDED Requirements

### Requirement: Styling coverage in the author handoff

The author guide and the single-file author skill SHALL cover plugin styling as a
first-class step: the SDK theme helper, the optional token stylesheet, both shell
themes plus high contrast, editor-library theme mapping, native controls,
contrast, focus visibility, reduced motion and the manual verification checklist.

#### Scenario: Guide styling page

- **WHEN** an author opens the guide index
- **THEN** a styling page is linked next to the manifest, protocol, SDK, hosting
  and consent pages, and the SDK page links to it from the theming section

#### Scenario: Runnable example

- **WHEN** an author follows the styling code example with the starter template
- **THEN** the named SDK imports, token names and CSS selectors exist and the
  example needs no shell source or private path

#### Scenario: Both themes are checked

- **WHEN** an author follows the styling checklist
- **THEN** it requires toggling the shell theme while the plugin is visible,
  confirming the page, text, inputs, focus ring and scrollbars follow, and
  checking the high-contrast mapping used by the plugin's editor library

#### Scenario: Skill step

- **WHEN** the `create-exo-plugin` skill builds a visible editor
- **THEN** it includes the theme helper, a token-based CSS example and a
  deployed light/dark verification item before the ship checklist
