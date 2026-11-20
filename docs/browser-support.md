# Browser support

Status: v1 support matrix. The runtime unsupported states must match this table;
a change that adds a provider or verifies a new browser updates this file and
its tests in the same change.

## Matrix

| Browser | Folder-backed workspace | Remote workspace (Stratofold) | Plugin host | Evidence |
| --- | --- | --- | --- | --- |
| Chromium desktop (Chrome, Edge) - tested 131.0.6778.264 | Supported | Supported | Supported (editors, panels, content views) | Layers 2 and 4-10 deployed verification; P1-P3 remote verification; view surfaces at commit `3f69504`; `docs/providers/stratofold.md` |
| Firefox desktop - current stable | Unsupported - explicit state | Supported for browsing, read, write and save; plugin host unverified | Unverified | Layer 2 deployed verification (explicit unsupported state); P1 deployed verification on Chromium and Firefox |
| Safari desktop - current stable | Unsupported - explicit state | Unverified | Unverified | v1 non-goal; P1 records Safari as unverified |
| Mobile browsers | Out of scope | Out of scope | Out of scope | v1 vision non-goal |

"Supported" means the combination was exercised against the deployed shell and
the named evidence exists. "Unverified" means no release evidence exists and the
documentation must not claim it works. Remote workspace support is independent of
folder support: Firefox can open a Stratofold workspace even though the folder
picker is unavailable.

## Runtime behaviour

- A browser without `showDirectoryPicker` starts in the `unsupported` phase. The
  explorer explains the limitation, does not offer Open Folder, and still offers
  Connect Remote. No fabricated tree or mock workspace appears.
- Connect Remote is available in every browser. A validated connection mounts the
  remote workspace with the role-derived capabilities; a viewer or public
  connection stays read-only.
- The plugin host starts only after a workspace is ready. On Firefox with a
  remote workspace, the shell opens files and plugins are not separately
  verified; the matrix says so instead of assuming parity. Panels and content
  views use the same host and sandbox, so their Firefox status follows the
  unverified plugin-host entry rather than being claimed separately.
- Safari and mobile are not claimed. If a user opens the shell there, folder
  workspaces show the unsupported state and remote workspaces are unverified.

## Tests and evidence

- `apps/shell/src/workspace/runtime.test.ts` "marks unsupported browsers
  explicitly" pins the unsupported phase and read-only snapshot.
- `apps/shell/src/workspace/runtime.remote.test.ts` "opens a remote workspace
  when the browser cannot open folders" pins the remote path in that state.
- `apps/shell/src/App.test.tsx` "shows an explicit unsupported state instead of
  mock files" pins the UI copy and the absence of a tree; it also checks that
  Connect Remote remains offered.
- `apps/shell/src/quality/browser-support.test.ts` checks this matrix still
  classifies Chromium, Firefox, Safari and mobile and keeps the unsupported and
  unverified labels.
- Deployed evidence dates and browser versions are recorded in
  `ROADMAP.md` and [`providers/stratofold.md`](./providers/stratofold.md).

## Updating the matrix

A change that verifies a browser/provider combination updates the row, adds the
deployed evidence date and version, and adjusts the runtime tests if the
unsupported state changes. A combination without evidence is labelled
unverified, not supported.
