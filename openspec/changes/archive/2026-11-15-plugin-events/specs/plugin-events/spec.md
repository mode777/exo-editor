# Spec Delta

## ADDED Requirements

### Requirement: Change producers

The shell SHALL publish `workspace/file-changed` for changes observed by the
workspace watcher or its polling fallback, for its own successful writes from
either document surface, and for renames, using one observation path and no
second watcher or polling loop. It SHALL publish `theme/changed` when the active
theme value changes, and `workspace/closed` once before handler frames are
disposed. It SHALL NOT publish `config/changed` in v1.

#### Scenario: External change is published

- **WHEN** the provider reports an external change or the focus poll observes one
- **THEN** subscribed frames receive one `workspace/file-changed` for the path

#### Scenario: Shell save is published

- **WHEN** a document saved from the shell text surface or a plugin editor writes successfully
- **THEN** subscribed frames receive `workspace/file-changed` with kind `changed` and the new version

#### Scenario: Theme change is published

- **WHEN** the user switches the workbench theme
- **THEN** subscribed frames receive `theme/changed` with `dark`, `light` or `high-contrast`

#### Scenario: Closing a workspace

- **WHEN** the shell releases the active workspace before disposal
- **THEN** subscribed frames may receive one `workspace/closed` with `switch` or `close`

#### Scenario: No duplicate observation

- **WHEN** a shell save succeeds
- **THEN** the shell publishes from that save's result and does not also emit a second event for the same write from a watcher or poll

#### Scenario: Reserved configuration topic stays silent

- **WHEN** the shell is running v1 without plugin settings
- **THEN** no `config/changed` event is published

## MODIFIED Requirements

### Requirement: Coalescing and ordering

The shell SHALL coalesce changes to the same path within 50 ms, SHALL prefer
`deleted` over `created` over `changed` when coalescing, SHALL report a rename as
a single `renamed` event on the new path, and SHALL emit a document's save result
before its `workspace/file-changed` event. It SHALL deliver the targeted
`shell/file-changed` notification to the bound document's handler immediately
from the same observation, without coalescing, and SHALL keep that
notification's kind, path and version consistent with the coalesced
`workspace/file-changed` event; the topic event SHALL be the only
subscription-channel form.

#### Scenario: Burst of writes

- **WHEN** the same file is written three times within 50 ms
- **THEN** subscribers receive one `changed` event for that path

#### Scenario: Create then delete

- **WHEN** a path is created and deleted within the coalescing window
- **THEN** the shell emits `deleted` rather than both events

#### Scenario: Rename

- **WHEN** a file is renamed
- **THEN** subscribers receive one `renamed` event carrying the new path and no separate deletion for the old path

#### Scenario: Self-save ordering

- **WHEN** a plugin saves its own document
- **THEN** its `shell/save-result` arrives before the `workspace/file-changed` event for that write

#### Scenario: Bound handler is notified immediately

- **WHEN** the open document's file changes twice within the coalescing window
- **THEN** its handler receives a targeted `shell/file-changed` for each observed change while subscribers receive one coalesced topic event

#### Scenario: Targeted and topic agree

- **WHEN** a change is delivered both as a targeted notification and as a topic event
- **THEN** both carry the same path and kind, and the same version when the kind is not `deleted`
