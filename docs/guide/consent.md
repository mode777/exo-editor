# Consent

No plugin code loads until the user approves the exact origin and the capability
fingerprint. The shell validates the manifest first, shows the dialog, and mounts
the controller frame only after approval. The normative rules are in
[`docs/contracts/plugin-manifest.md`](../contracts/plugin-manifest.md) and the
bootstrap and registration phases in
[`docs/contracts/plugin-protocol.md`](../contracts/plugin-protocol.md).

## What the user sees

The dialog shows:

- plugin id, name, version, publisher and the exact manifest origin;
- the controller entry URL and the plugin root covered by consent;
- every declared permission, in plain language;
- every declared file-editor glob and label;
- for `rendering: "frame"`, that the plugin may display an editor surface in the
  document area, while tabs, headers and Save stay shell-owned;
- for a same-origin plugin, that it runs with an opaque origin and cannot be
  isolated by origin or use storage.

The user can approve or deny. The decision is stored machine-wide, keyed by the
manifest origin plus plugin id. It survives reloads and other workspaces.

## When consent is requested again

The fingerprint covers the capability surface: origin, plugin id, plugin root,
permissions, globs, priorities and frame rendering. Consent is requested again
when that surface widens. It is not requested again when only display metadata
changes, such as the name, description, publisher, homepage or icon.

Adding a page inside the plugin root does not re-prompt: the root is the consent
unit, not each page (D14). Adding a permission, a glob, changing a priority or
opting into `rendering: "frame"` does.

## Denied, revoked and failed

- Denying leaves the plugin declared but not loaded. Matching files fall back to
  the shell text surface or the no-editor state; no frame exists.
- Revoking an active plugin tears down its registrations and frames and returns
  the entry to `awaiting-consent`. The shell does not reopen the dialog by
  itself.
- A manifest fetch, validation, timeout or registration failure is reported with
  a stable code and phase in the plugin log. It does not mount a half-valid
  plugin.
- A workspace switch clears workspace-scoped host state and log entries. Consent
  records remain, by design.

## For plugin authors

- Keep the capability surface minimal. Ask for `workspace:read` unless you
  genuinely write; add `events:subscribe` only if you consume events.
- Do not change a glob or permission casually: it forces every user to consent
  again.
- Do not render a fake consent prompt or bypass the shell's dialog; the plugin
  cannot mount its own controller without the shell's decision.
- Never read `exo.json` or `/.exo/**`; they are shell-only and the session denies
  the request.

Next: [hosting](./hosting.md) or [testing](./testing.md).
