# Tasks

## 1. Frame grant

- [x] 1.1 Add the per-frame live-invocation set and `beginUserInvocation`/`endUserInvocation`/`hasLiveCommandInvocation` to `FrameSession`; verify the grant is visible only to the target session and is cleared by `dispose`, `close`, `fail` and `finishDispose`.
- [x] 1.2 Replace the new-file focus gate with `visible() && (hasFocus() || hasLiveCommandInvocation())` and apply the same gate to `plugin/request-files`; verify permissions, capabilities, size and rate checks still run first.
- [x] 1.3 Use the same predicate in the `HandlerPool` and `ViewPool` wrappers; verify hidden, inactive and unfocused frames still receive `permission-denied`.

## 2. Command lifecycle

- [x] 2.1 Add optional `beginUserInvocation`/`endUserInvocation` to `CommandTargetSession`, mark the target before `sendCommand`, and clear it from `clearPending`; verify result, timeout, disposal, plugin stop and `reset` all revoke it.
- [x] 2.2 Clear the grant for the envelope's `replyTo` in `FrameSession.handleCommandResult` before listeners run; verify a request after the result is denied.
- [x] 2.3 Verify concurrent commands on one frame keep the grant until the last invocation settles, while another frame never receives it.

## 3. Tests

- [x] 3.1 Add controller unit coverage for the live grant set and settlement.
- [x] 3.2 Add a shell-level suite with a real `ViewSession` and `PluginCommandController`: unfocused panel and content-view new-file creation, post-result and post-timeout denial, another frame denial, read-only and missing-write denial, picker grant and post-result denial, disposal with a pending dialog, direct focused creation and unfocused background denial.
- [x] 3.3 Verify no focus change occurs and no protocol-violation or consent prompt is introduced by the grant.

## 4. Contracts and documentation

- [x] 4.1 Update `docs/contracts/plugin-protocol.md` sections 5.2.1, 5.2.3 and 5.6.1 with the grant, its scope and its end conditions.
- [x] 4.2 Update the `plugin-commands`, `plugin-protocol` and `plugin-file-creation` main specs and the change deltas.
- [x] 4.3 Update the author guide's manifest, protocol and SDK pages plus `docs/performance.md`.
- [x] 4.4 Bump the shell to `0.8.0` and update `CHANGELOG.md`, `docs/releases.md`, `ROADMAP.md`, `AGENTS.md`, `README.md` and `apps/shell/package.json`/`SHELL_VERSION`; verify the changelog and version tests pass.

## 5. Verification

- [x] 5.1 Run lint, format check, typecheck, the full unit test suite, the shell build, bundle budget, CSP, custom elements, no-SDK, no-Monaco, template and code-plugin builds/copies, the secrets check and `openspec validate --all`.
- [ ] 5.2 Deploy the change and verify the command-target flow against the deployed URL, then record the deployed commit and date.

## Workflow follow-up

- Archive `command-invocation-user-activation` after deployed verification and confirm the main specs and contracts remain consistent.
