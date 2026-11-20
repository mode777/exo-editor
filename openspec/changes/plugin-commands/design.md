# Design

## Context

See [`proposal.md`](./proposal.md) for motivation. The shell already has the pieces a command needs: a per-workspace `PluginHost` with a revisioned snapshot, an `EditorRegistry` keyed by plugin identity, a `RegistrationSession` that acknowledges editor contributions, a `HandlerPool` with one session per open document, and an `App` command registry passed to `vscode-workbench`. The prerequisite `plugin-view-surfaces` change adds a `ViewPool`, view sessions and `ViewClient`, and lazily mounts panels and content-view tabs.

Three current constraints shape the design:

- Registration frames are hidden and disposed after the acknowledgement. They are not a place to run work.
- The workbench preset owns the tab strip and top-level menus. It has no editor-title action API and no plugin menu model.
- Manifest validation rejects unknown `contributes` keys, so an older shell must reject a newer manifest by `engines.exo` before it reaches those keys. Validation already checks `engines.exo` before `contributes`, so a plugin that adopts commands declares `engines.exo` at or above shell `0.4.0` and older shells report `incompatible-engine`.

## Goals / Non-Goals

**Goals:**

- One command model that covers editor actions, generator/report panels and tabbed content views without a new frame mode or a background frame.
- Delivery only to a live frame of the same plugin identity, with the target's existing permissions unchanged.
- Shell-owned presentation and attribution on every surface.
- Deterministic ordering and bounded concurrency, timeouts and result text.
- A typed SDK path that answers every invocation automatically.

**Non-Goals:**

- Command execution without a user action, a persistent controller frame or a one-shot command frame.
- Cross-plugin invocation, plugin keybindings, a `when` expression language, or contributions to the File/View menus.
- New file, workspace or event permissions; the target frame's existing capabilities are the ceiling.
- A general plugin menu system; only the three declared placements are supported.

## Decisions

### D1 - Run commands in existing live frames, not in a new frame mode

A command executes in the frame that already represents its surface: the active document's handler for editor actions, a panel frame for panel actions, a content-view frame for tab actions. This reuses the sandbox, origin checks, permission set, read/list/create paths and disposal flow already specified for those frames. It also means no new `exo-mode`, no second handshake and no new bootstrap surface.

Alternatives rejected:

- **One-shot hidden command frame.** It would execute without any open surface, but it adds a fourth frame mode and a second lifecycle, has a cold-start cost per command, and cannot act on the active editor's buffer unless it re-reads and writes the file through paths that do not exist yet.
- **Persistent controller frame.** Keeping the registration frame alive turns a throwaway handshake into a background frame, which the event and view changes deliberately avoided.
- **Declarative aliases for shell actions.** Safe but not a plugin command: a plugin could only re-label an existing shell intent, not format, generate or inspect.

### D2 - Three target kinds with a declaration requirement

`activeEditor` is a string target. Panel and content-view targets are `{ kind, id }` objects. A view target must name a contribution declared in the same manifest. At registration completion the shell also requires the target contribution to be registered in that session; otherwise the command is rejected with `target-not-registered`. This keeps a command from pointing at a surface that can never exist.

`activeEditor` is available only when the active document's `DocumentEditor.pluginId` and origin match the command's plugin identity. View targets are available while the plugin is active; the shell reveals or opens the target on invocation.

Alternative rejected: a generic `frame` target or a fan-out to all live frames. Both make the receiving frame responsible for deciding whether it owns a command, which is ambiguous and hard to attribute.

### D3 - Menu placement is a validation rule, not a `when` language

`menus` is a subset of `commandPalette`, `explorer/context` and `editor/title`, defaulting to the palette. `editor/title` requires `activeEditor`; `explorer/context` requires a view target. The rule follows from the arguments and availability: an editor action is meaningful only for the active editor, and an explorer action must have a place to run when no editor is open.

Alternative rejected: VS Code-style `when` clauses. A condition evaluator is a second language inside the manifest, with parsing, validation and test cost, for behavior the target already expresses.

### D4 - Command registration is an additive subset

`plugin/register` gains `commands?: string[]`, preserving the existing editor contribution shape. `shell/register-ack` gains `acceptedCommands: string[]` and `rejected[]` gains an optional `kind`. `accepted` keeps its glob meaning. Registration order is arrival order; duplicate ids collapse into one. Target validation runs at `register-complete`, because a controller may send the panel and its command in either order within the same session.

Alternative rejected: replacing `accepted` with a tagged contribution array. It would break every existing SDK parser for no gain; the project's convention is an additive field per contribution kind.

### D5 - One invocation controller owns resolution, gating and timers

A `PluginCommandController` in `apps/shell/src/plugins/commands.ts` is the only path from a UI surface to a frame. It receives a command reference, a source (`palette`, `explorer`, `editorTitle`) and an optional resource, then:

1. re-resolves the command from the live snapshot;
2. checks the per-command single-flight and five-second cooldown;
3. checks the plugin-wide five-invocation limit;
4. resolves the target: the active document's handler, `ViewPool.reveal(identity, panelId)` or `ViewPool.open(identity, viewId, instanceKey)` for content views;
5. waits until the target session is active, sends `shell/command` with a generated invocation id, and starts the ten-second timer;
6. completes on a matching `plugin/command-result`, timeout, frame disposal or teardown.

The content-view instance key is `command/<commandId>`, so repeated invocations focus one tab. A panel reveal reuses the view pool's lazy mount and hidden-retain rules.

Alternatives rejected: each UI component calling the handler or view session directly (duplicates gating and timer logic); putting invocation state in the registry (the registry should stay data-only and synchronous).

### D6 - Arguments are shell-derived, never plugin-supplied

Only an explorer invocation carries arguments: `{ path, kind }` for the selected entry, normalized through the existing path rules. Palette and editor-title invocations carry no arguments. A handler already knows its own file path from `shell/init`, and a palette command can use its panel or content view to ask the user. This keeps the message a fixed shape, avoids a generic data channel between the shell UI and a frame, and guarantees no file content or handle is forwarded.

Future menu placements can add a versioned argument shape; they do not need a generic object.

### D7 - Results are correlated, bounded and non-destructive

`plugin/command-result` echoes the invocation id in `replyTo`. `{ ok: true }` clears the pending entry. `{ ok: false, message }` shows a plain-text notice and logs the failure. The message is truncated to 200 characters and rendered as text, never HTML. A ten-second timeout logs `timeout` and shows a non-blocking notice but does not dispose the frame: a panel or editor remains usable. A late result is ignored by matching against the live invocation id and frame session. Commands are expected to be short actions; long work belongs in a panel that reports its own progress.

Limits: one in-flight invocation per command, five per plugin, five-second cooldown, ten-second result timeout. The single-flight rule protects against double-click mutations; the plugin-wide cap bounds timer and result state.

### D8 - Presentation uses shell-owned, live-derived surfaces

**Palette.** `createExoCommandRegistry` takes a `pluginCommands` provider and reads it in `list()`. Each entry gets a synthetic id `exo.plugin.<encodeURIComponent(identity)>.<commandId>`, a title, and a category of `pluginName` or `pluginName · category`. `run()` calls the controller and returns false for a stale entry. The registry stays memoized; because `list()` reads the live snapshot, no palette re-render is needed when a command registers.

**Explorer context menu.** `ExplorerView` reads `usePluginHost()` and appends a separator plus at most ten entries for active commands with `explorer/context`, labelled with the plugin name. The existing keyboard handling and `role="menu"`/`menuitem` pattern are reused. Overflow stays available in the palette.

**Document action row.** `DocumentArea` reads `usePluginHost()` and renders a `role="toolbar"` row above the document when the active document's plugin has `activeEditor` commands with `editor/title`. Buttons are shell-owned, outside the sandboxed frame, with accessible names that include the plugin. This is a contained addition rather than a preset change; the preset has no tab-action API and the shell must not patch it.

**Notices.** A shell-owned `role="status"` notice region above the status bar shows failure and timeout text. It auto-dismisses and has an explicit dismiss button. Success is silent.

Alternative rejected: adding plugin commands to the static `workbenchMenus` array. Menus would need to be rebuilt on every host revision, and the File and View menus would become a dumping ground with no target-aware availability.

### D9 - Attribution and id isolation

A plugin command never receives a shell command id. The palette id is synthetic, so a plugin cannot collide with `exo.settings.open` even if its own id matches. Display surfaces include the plugin name in the category, the context-menu label and the action button's accessible name. Commands are invoked only by shell UI; there is no protocol message that accepts a command id from a plugin, so cross-plugin invocation has no path.

### D10 - Consent display is not part of the fingerprint

Commands are user-invoked and run in frames the user has already approved. They grant no autonomous access and no new permission, so `contributes.commands` is excluded from `computeFingerprint` and adding one does not re-prompt. The first-grant dialog lists each command's title, target kind and placements. The residual risk is a misleading title; attribution on every surface and the absence of a shell-id alias bound it. The security review records the decision and its mutation test.

### D11 - SDK answers every invocation automatically

`RegistrationClient.registerCommand(id)` sends one id per call and exposes `acceptedCommands`. Editor and view clients share a `CommandClient` helper: `onCommand(handler)` stores the handler, and each incoming `shell/command` is answered with exactly one result. A resolved promise or void return is success; a thrown error or a returned failure is `{ ok: false }` with a bounded message. Messages that arrive before a handler is attached queue up to ten; beyond that the client answers with a failure so the shell's timer does not hang. `capabilities.commands` is parsed absent-as-false. The SDK version becomes `1.6.0`.

Alternative rejected: requiring plugins to call `completeCommand()` themselves. A missed call would leave every invocation until timeout, and the SDK can derive the common cases without a second API.

### D12 - Sequencing and versioning

Land `plugin-view-surfaces` first: panel and content-view targets use its view pool and `ViewClient`. `plugin-file-creation` is independent. Commands lands first, so it takes shell `0.4.0` and SDK `1.6.0` and `plugin-file-creation` is renumbered to shell `0.5.0` and SDK `1.7.0` in the same change, leaving no release gap.

### D13 - Workspace teardown is the reset boundary

The controller, command registry, cooldowns, pending invocations and notices live in the workspace runtime. `PluginHost` removes a plugin's commands on stop, revoke and workspace switch; the controller cancels pending invocations and drops timers. Late results carry both an invocation id and the frame session, so a result from a previous workspace cannot complete a current invocation.

## Risks / Trade-offs

- **First panel command pays a cold mount.** Lazy mounting is a view-surfaces rule; a command that reveals a panel for the first time waits for the frame. Measure the first-command path in `docs/performance.md`; if it misses the budget, keep the panel mounted while the plugin is active rather than adding an eager command frame.
- **Ten seconds is short for a generator.** Commands are actions, not jobs. A long-running generator opens its panel and returns quickly; the panel reports progress. Document this in the author guide so authors do not block the result.
- **A misleading command title can still imitate the shell.** Every surface prefixes the plugin name and no shell id can be reused. The consent dialog lists the commands. Record the residual risk in the security review and test the palette rendering with a hostile title.
- **Explorer menus can overflow.** The shell caps plugin entries at ten and keeps the palette complete. A keyboard user can always use the palette.
- **The static menu model cannot host plugin entries in File/View.** This is deliberate: those menus describe shell behavior. If a later change adds top-level placements, it needs its own contract and validation.
- **Registration order matters for the palette.** `exo.json` declaration order then registration order is deterministic, but a plugin that registers commands late appears later. The host snapshot sorts by the stable keys, not by acknowledgement timing.
- **Older shells reject newer manifests.** A plugin that adopts commands must set `engines.exo` so older shells report `incompatible-engine`; otherwise the unknown `contributes.commands` key produces `invalid-manifest`. The author guide documents the range and the SDK compatibility rule.

## Migration Plan

1. Extend the schema, manifest types and validation; keep the fingerprint input unchanged and add the positive test that a command-only manifest keeps its stored fingerprint.
2. Extend registration parsing and the acknowledgement; add the command registry and host snapshot fields.
3. Add `PluginCommandController` and the invocation path against the view pool and handler pool.
4. Add palette, explorer and document-action surfaces plus the notice region and accessible names.
5. Add the SDK registration helper, `onCommand`, the support bit and the version bump; keep the conformance suite green.
6. Extend the fixture and the deployed verification path; update contracts, guide, security review, accessibility, performance, walkthrough, changelog and roadmap follow-up.

Rollback is a shell redeploy. The feature is additive: a plugin that declares `engines.exo` above the previous shell cannot load there, and a plugin that does not use commands is unaffected. A deployed shell that removes the feature must keep the manifest `engines` check so a command manifest fails closed rather than being parsed into a partial command set.

## Open Questions

None. The view dependency, version numbers and the ten-second result budget are decided here; any change to them changes the specs and belongs in a later change.
