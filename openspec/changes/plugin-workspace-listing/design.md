# Design

## Context

See `proposal.md` for motivation and the four delta specs for normative
behavior. The existing pieces this design builds on:

- `WorkspaceSession.forPlugin(pluginId).list(path)` already returns direct
  children, filters `/exo.json` and `/.exo/**`, normalizes paths and logs denials.
  It has no page or cursor concept; the explorer lazily lists one directory and
  renders it.
- `HandlerSession` owns one editor frame's protocol state and disposal.
- `HandlerPool` owns frame lifecycle and the per-document visible surface.
- The manifest validator and consent dialog have a closed permission vocabulary
  and a fingerprint that hashes the sorted permissions.
- The SDK has a generic correlated-request path that can carry a new reply type.

The separate `plugin-file-picker` change is not a prerequisite. Both changes add
independent support bits and messages; when both are present, the listing SDK
minor follows the picker minor.

## Goals / Non-Goals

**Goals:**

- Add permissioned, bounded, one-level directory discovery for handlers.
- Keep the workspace provider contract unchanged and reuse the plugin-scoped
  facade rather than introducing a second filesystem path.
- Make pagination stable and cheap without materializing a new provider method.
- Make the permission difference visible: `workspace:list` re-prompts existing
  readers, while exact-path reads and the user picker stay unchanged.

**Non-Goals:**

- Recursive listing, glob matching, full-text search or a file index.
- Returning content, `mtime`, versions, handles, `File` or `Blob` values.
- A `WorkspaceAccess.list` signature or provider change.
- Listing without `workspace:read` or without an editor handler.
- A background frame, whole-tree watcher or change feed for unopened files.
- A manifest `schemaVersion` bump.

## Decisions

### D1 - `workspace:list` is a separate permission that requires read

The permission ladder is:

| Permission | Grants |
| --- | --- |
| `workspace:read` | Read known paths; use the user-mediated picker |
| `workspace:list` | List one directory level, in addition to read |

`workspace:list` requires `workspace:read` because listing is an editor-phase
message and every handler needs read to open a document and to use the results.
A listing-only manifest would be dead: it cannot mount a handler. Requiring read
keeps the combination meaningful and makes the consent prompt show both.

The validator rejects `workspace:list` without `workspace:read`, like the
existing `workspace:write` rule. The permission is added to the sorted
permissions input, so adding it changes the fingerprint and re-prompts; a plugin
that never adds it keeps its stored consent. This is the key privacy difference
from putting listing under `workspace:read`, which would silently widen every
approved reader.

Alternatives: make `workspace:list` independent (dead permission in v1); make it
imply read (silently widens consent); reuse `workspace:read` (violates the
fingerprint's exhaustive-input rule).

### D2 - One level only, with a broker-side snapshot cursor

`plugin/request-list` names a directory and an optional cursor. The shell lists
one level through `forPlugin(pluginId).list(path)`, sorts the entries with
directories before files and then by path using the workspace's case-sensitivity
rule, filters reserved entries again, and serves pages of 1,000.

The first page creates a snapshot: the sorted entry array plus a snapshot id and
generation. `nextCursor` is an opaque token carrying the snapshot id and offset.
Later pages slice the same snapshot, so pagination is stable and does not repeat
the provider listing for every page. Snapshots are workspace-scoped and
handler-scoped, cleared on disposal or workspace switch, and capped (for example
eight directories or 20,000 entries per handler) with LRU eviction. An invalid,
foreign or evicted cursor returns `not-found`; the plugin lists again.

This keeps `WorkspaceAccess.list` unchanged. The provider still materializes one
directory, which the explorer already does under the 10k-entry performance
budget. A recursive API would need a bounded `ListOptions` or a new provider
method; that is deliberately deferred.

Alternatives: return every entry in one reply (large payloads and UI cost); use
an offset-only cursor by re-listing on every page (repeated provider work and
unstable pages); add `maxEntries`/cursor to `WorkspaceAccess.list` (a wider
workspace contract change for a broker concern); implement recursive traversal in
the broker (unbounded provider calls and no clear consent story).

### D3 - Minimal entry shape

The reply entry is `{ path, kind, size? }`. `path` is `/`-rooted and normalized;
`kind` is `file` or `directory`; `size` is present for files and absent for
directories. `mtime` and the opaque content `version` are excluded because the
consumer needs discovery, not cache or conflict tokens, and `mtime` reveals user
activity. Content and handles never cross; reads still use `plugin/request-file`.

Alternatives: reuse `FileStat` (over-shares metadata and couples the wire shape
to the workspace API); include `version` for future caching (no protocol use for
a read-only listing and a new consistency burden).

### D4 - The shell support bit is separate from the permission

Editor `shell/init` gains `capabilities.directoryListing`. A new shell sends
`true`; older shells omit it. The SDK defaults absence to `false` and
`listDirectory()` checks both the support bit and `workspace:list` before
sending. This mirrors the picker's feature detection and avoids inferring
support from `shell.version` or from `workspace:read`.

Alternatives: add a general `features` array (more future-proof but a second
shared protocol change); infer from `shell.version` (forbidden by the protocol);
send and wait for `unsupported-message` (works but makes plugin UI fail late).

### D5 - Bounds are protocol behavior, not provider behavior

A page is capped at 1,000 entries. A frame may have at most four listing
requests in flight and twenty per rolling second; beyond that the shell replies
`rate-limited` without queueing. A page has a five-second deadline and aborts
with `timeout`; a late result after disposal is dropped. These bounds protect the
shell, the remote provider and the UI without changing the workspace contract.

The listing request is editor-phase and correlated. It does not need an active
visible frame: unlike the picker, it has no user-facing modal and no data beyond
the permission the user approved. A hidden handler can list if it has the
permission.

Alternatives: rely on the existing 64 in-flight cap (too permissive for a
directory walk); enforce the cap only in the SDK (a hand-written plugin bypasses
it); add provider quotas (the provider is shared with the explorer).

### D6 - Reserved filtering is the facade's job

The broker calls `forPlugin(pluginId).list(path)` and never the shell-side
session. The facade denies a reserved requested directory, filters reserved
entries from the result and attributes denials to the plugin. The broker
re-checks each entry's path before adding it to a page, so a provider or cache
bug cannot leak a reserved path. A reserved path never becomes a cursor or a
snapshot key.

Alternatives: use the shell session and filter in the broker (duplicates the
one guard the contract says is shared); add a new listing facade (no benefit).

### D7 - Error and compatibility surface

The protocol gets `not-a-directory` (the workspace already has that code) and
uses the existing `not-found`, `permission-denied`, `rate-limited`, `timeout` and
`internal` codes. `not-a-directory` must be mapped explicitly; the current
`shellCodeFor()` maps it to `not-a-file`, which would be wrong for a listing.

The manifest permission value is additive within `schemaVersion` `1`. A manifest
that uses it should have an `engines.exo` range that includes a listing-capable
shell; the manifest validator checks `engines.exo` before the permission
vocabulary, so an older shell reports `incompatible-engine` rather than
`invalid-manifest` for a correctly versioned plugin.

## Risks / Trade-offs

- **Snapshot memory grows with large directories.** → Cap snapshots per handler
  and total entries, evict LRU, and return `not-found` for an evicted cursor.
- **Snapshots are stale by design.** → Call the listing a snapshot, not a
  watcher; a fresh no-cursor request observes new state. Tests cover create and
  delete between pages.
- **A cursor is a state handle.** → Make it opaque, bind it to the handler and
  requested path, reject foreign or malformed cursors, and clear it on disposal
  or workspace switch.
- **Large directories and remote latency.** → One level at a time, 1,000-entry
  pages, a five-second page deadline, snapshot reuse, and the existing lazy
  explorer performance budget.
- **Listing is a meaningful privacy widening.** → Separate permission, read
  dependency, consent text, fingerprint re-prompt and a mutation test that
  removing the permission check fails.
- **Reserved paths could leak through pagination.** → Facade filtering plus a
  per-entry re-check before the page is cached or returned.
- **Old shells reject the new permission.** → Additive `engines.exo` guidance and
  an SDK fallback to exact-path reads; no existing manifest is changed.
- **A hidden handler can list without a user gesture.** → That is the approved
  `workspace:list` permission; the consent dialog says so. The user picker remains
  the gesture-bound alternative.

## Migration Plan

1. Deploy the shell, manifest vocabulary, consent text and fixture first.
2. Publish the SDK helper in the next additive minor. If `plugin-file-picker`
   lands first, listing is `1.3.0`; otherwise it takes `1.2.0`.
3. Existing manifests are unchanged and keep their consent. A plugin that adopts
   `workspace:list` re-prompts and must set a compatible `engines.exo` range.
4. Rollback is the shell deploy; the permission and message are additive for
   plugins that did not adopt them, and a plugin that did adopt them degrades to
   exact-path reads on the older shell.

## Open Questions

None that change the specs or task breakdown. Recursive traversal or a bounded
find API would be a separate change with a workspace-API cap or cursor; the
current one-level API is complete for the stated consumer.
