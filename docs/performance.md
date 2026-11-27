# Performance budgets

Status: budgets are recorded for the `release-readiness` change. The deployed
measurements are filled in [Results](#results) at task 8.4. The bundle budget is
the only performance gate that runs in CI; the runtime budgets are a release
checklist item performed manually against the deployed site.

## Budgets

| Budget | Ceiling | Measurement |
| --- | --- | --- |
| Plugin frame startup | 2,000 ms | Open a matching file in the demo workspace, measure until the reference code plugin's Monaco surface is visible and focusable |
| Plugin panel or content-view startup | 2,000 ms | Reveal a registered panel or open a content-view tab, measure from the user action until the view frame is visible over its placeholder |
| Plugin bottom-panel startup | 2,000 ms | Reveal a registered bottom tab (first mount and a retained re-reveal), measure from the tab selection until the view frame is visible over its placeholder |
| Marketplace catalog first load | 3,000 ms | Open Extensions with no loaded catalog and measure until the official feed rows are painted (source fetch plus feed fetches; no startup request) |
| 10k-entry directory listing | 3,000 ms total, 1,000 ms longest task | Expand a directory with 10,000 entries and measure until every row is painted |
| 1 MiB file open | 1,000 ms | Shell text surface and reference code plugin, from activating the file to the editable surface |
| 1 MiB file save | 1,000 ms | Shell text surface and reference code plugin, from Save to the shell's success state |
| Shell bundle (JS) | 186,000 gzip bytes | `npm run budget` / CI `Bundle budget` |
| Shell bundle (CSS) | 14,600 gzip bytes | `npm run budget` / CI `Bundle budget` |

These are release ceilings, not product SLOs. They are intentionally generous
for software rendering on a shared verification host.

## Reference environment

- Verification server described in the workspace `AGENTS.md`: Ubuntu 24.04,
  3 vCPU, ~3.7 GB RAM, software rendering.
- Chrome for Testing 131.0.6778.264 (headless shell) at
  `~/browsers/chrome-headless-shell/linux-131.0.6778.264/chrome-headless-shell-linux64/chrome-headless-shell`.
- Deployed URL `https://mode777.github.io/exo-editor/`, using an OPFS handle
  that mirrors `examples/demo-workspace/` through a `showDirectoryPicker` stub,
  as in the layer 5-9 verification.
- Same viewport (1280x800) and a fresh page per run. The 1 MiB fixtures are
  generated into the OPFS handle by the measurement script, not committed.

## Procedure

1. Build and deploy the current `main`; record the deployed commit.
2. Start `chrome-headless-shell` with remote debugging, open the deployed shell
   and mount the demo workspace through the OPFS stub.
3. Warm up once: open and close a `.ts` file, expand the 10k directory, open
   and save a 1 MiB file, reveal a panel, open a content view and reveal a
   bottom tab.
4. Run each measurement five times with the same setup; record every run. Use
   `performance.now()` from navigation or the action start, and
   `PerformanceObserver` long-task entries for the listing. For a panel,
   content view or bottom tab, start at the activation/click and stop when the
   view iframe is visible over its placeholder.
5. Report the median and maximum. A run with a page error is discarded and
   repeated.
6. Put the results in the table below with the date, deployed commit and browser
   build.
7. If a ceiling is exceeded, fix the regression (for the listing, batch row
   rendering in `requestAnimationFrame` without changing tree semantics) or
   record an accepted miss with a rationale, owner and follow-up. An accepted
   miss blocks the release until it is written down.

The 10k listing also has a structural guard in
`apps/shell/src/explorer/explorer.perf.test.tsx`: one `list` call, no per-entry
`stat`, and no recursive traversal. That test runs in CI; the wall-clock
measurement does not.

## Results

Measured on 2026-11-16 against deployed commit `90172af`
(`https://mode777.github.io/exo-editor/`) on the reference environment above,
five runs after one warm-up. The workspace was the demo files plus a 1 MiB
`big.txt`, a 1 MiB `big.ts` and a 10,000-entry fake directory mounted through
the same `showDirectoryPicker` stub used for the layer 5-9 verification.

| Budget | Median | Maximum | Ceiling | Result |
| --- | --- | --- | --- | --- |
| Plugin frame startup | 706 ms | 815 ms | 2,000 ms | Met |
| 10k listing total | 1,094 ms | 1,176 ms | 3,000 ms | Met |
| 10k listing longest task | 442 ms | 551 ms | 1,000 ms | Met |
| 1 MiB open - shell text | 207 ms | 275 ms | 1,000 ms | Met |
| 1 MiB save - shell text | 33 ms | 35 ms | 1,000 ms | Met |
| 1 MiB open - code plugin | 798 ms | 942 ms | 1,000 ms | Met |
| 1 MiB save - code plugin | 49 ms | 90 ms | 1,000 ms | Met |

No miss was accepted. The first cold listing run before the warm-up was 3,681
ms; the procedure's warm-up removes that one-time cost, and the five recorded
runs are all below the ceiling. The raw runs are in the task evidence for
`release-readiness`.

### Plugin view surfaces (2026-11-20)

Measured on the deployed shell at commit `3f69504` (asset
`index-BotyjZ52.js`) on the same reference environment, five runs after one
warm-up. The workspace was a scratch folder with the deployed plugin-host
fixture and the view pages.

| Budget | Median | Maximum | Ceiling | Result |
| --- | --- | --- | --- | --- |
| Panel reveal (retained frame) | 28 ms | 140 ms | 2,000 ms | Met |
| Content-view open (palette) | 471 ms | 494 ms | 2,000 ms | Met |

The panel measurement hides and re-shows the retained primary panel; the first
cold mount is included in the earlier consent/registration interval and is
covered by the no-lazy-frame check. The content-view measurement starts at the
palette command and stops when the new content iframe is visible. Both are below
the 2,000 ms ceiling with no accepted miss.

### Plugin commands (2026-11-20)

Measured on the deployed shell at commit `6fa641e` (asset
`index-BowKZcSd.js`) on the reference environment, five runs after one warm-up.
The workspace was a scratch folder with the deployed plugin-host fixture. The
measurement starts at the explorer context-menu activation of **Generate Fixture
Report** and stops when the first-revealed primary panel is active and its frame
has recorded the command.

| Budget | Median | Maximum | Ceiling | Result |
| --- | --- | --- | --- | --- |
| First-command panel mount | 33 ms | 37 ms | 2,000 ms | Met |

The production build adds 4,329 gzip bytes over the view-surfaces measurement:
169,686 js against the raised 171,000 limit and 13,531 css against 14,000. The
increase is the command registry, invocation controller, palette/menu/toolbar
surfaces and notice region.

The `plugin-file-creation` build adds 3,739 gzip bytes over the command
measurement: 173,477 js against the raised 176,000 limit and 13,794 css against
14,000. The increase is the manifest template decoder, the create-only provider
paths, the Save As dialog, the explorer template menu, the new-file request
controller and the SDK helpers. The budget was raised by 5,000 bytes, leaving
roughly 1,260 bytes of headroom; no dependency or vendored asset was added, and
the new-file path performs no content transformation.

### Marketplace first load (2026-11-27)

Measured against deployed commit `badc141`
(`https://mode777.github.io/exo-editor/`) with the reference environment, five
fresh page loads. Each run opened Extensions and stopped when the official Exo
Code row was painted. Every run made exactly two marketplace requests
(`marketplace-sources.json` and `marketplace.json`) and no marketplace request
before the view opened.

| Run | Time |
| --- | --- |
| 1 | 118 ms |
| 2 | 137 ms |
| 3 | 138 ms |
| 4 | 117 ms |
| 5 | 108 ms |
| Median | 118 ms |
| Maximum | 138 ms |

The shell bundle measured 183,791 JS and 14,456 CSS gzip bytes before the plugin
copies, against the 186,000/14,600 budget.

### Editor-bound panels and bottom panel (2026-11-24)

Measured on the deployed shell at commit `c4106a4` (asset
`index-cvcmiO3Q.js`) on the reference environment, five runs after one warm-up.
The workspace was a scratch folder with the deployed plugin-host fixture. The
measurement starts at the **Toggle Panel** palette command that re-reveals the
retained bottom panel and stops when its iframe is visible over the placeholder.
The first cold mount happens during registration and is covered by the
no-lazy-frame check, as with the primary panel measurement.

| Budget | Median | Maximum | Ceiling | Result |
| --- | --- | --- | --- | --- |
| Bottom panel retained reveal | 14 ms | 18 ms | 2,000 ms | Met |

The run recorded 14, 18, 7, 14 and 10 ms with no page or console errors.

## Bundle budget

The committed budget lives in `apps/shell/budget.json` and is measured before the
template and code-plugin copies, so it continues to describe the shell only. The
CI steps are `node apps/shell/scripts/check-bundle-budget.mjs apps/shell/dist
apps/shell/budget.json` in the `verify` job. A change that needs a larger budget
must update the file and explain why in the change; the runtime budgets above are
independent of it.

The `plugin-file-picker` change raises the JS ceiling from 152,000 to 154,000
gzip bytes. The shell-owned picker dialog, its controller and the handler
message path add 1,541 gzip bytes over the previous ceiling (measured build:
153,541 JS, 13,235 CSS). The 2,000-byte allowance keeps roughly 450 bytes of
headroom for the next change; no dependency, font or vendored asset is added.
The picker lists lazily and does not change any runtime budget.

The `plugin-workspace-listing` change raises the JS ceiling from 154,000 to
157,000 gzip bytes. The handler dispatch, the snapshot/cursor broker and the
support bit add 2,175 gzip bytes over the previous ceiling (measured build:
155,716 JS, 13,235 CSS). The 3,000-byte allowance keeps roughly 1,284 bytes of
headroom; no dependency, font or vendored asset is added. Listing is one
directory level with a 1,000-entry page cap and does not change a runtime
budget.

The `plugin-local-events` change raises the JS ceiling from 157,000 to 159,000
gzip bytes. Local topic validation, per-identity sequences, the publish/ack
path and the SDK support bit add 1,340 gzip bytes over the previous build
(measured build: 157,056 JS, 13,242 CSS). The 2,000-byte allowance keeps roughly
1,944 bytes of headroom; no dependency, font or vendored asset is added. Local
delivery reuses the existing queue, schedule and rate machinery and does not
change a runtime budget.

The `plugin-view-surfaces` change raises the JS ceiling from 159,000 to 167,000
gzip bytes. The view frame mode, the shared session base, the lazy panel and
content-view pool, the navigation intents and the derived activity/secondary
chrome add 6,357 gzip bytes over the previous ceiling (measured build: 165,357
JS, 13,391 CSS). The 8,000-byte allowance keeps roughly 1,643 bytes of headroom;
no dependency, font or vendored asset is added. Panels mount lazily and content
views create a frame only when their tab opens, so the change adds no eager
frame and does not alter the existing runtime budgets.

The `command-invocation-user-activation` change adds the per-frame live-command
set and its checks to the existing command, picker and new-file paths. The
measured build is 174,302 JS and 13,785 CSS gzip bytes, an increase of 143 JS
bytes over the previous measured build and still below the unchanged
176,000/14,000 ceilings. No dependency, font or vendored asset is added, and the
grant performs no extra shell render, focus change or runtime measurement.

The `editor-bound-panels` change raises the JS ceiling from 176,000 to 178,000
gzip bytes. The bottom-panel registry, active-editor derivation, the targeted
`editor/active` topic and the SDK types add 1,657 gzip bytes over the previous
measured build (measured build: 176,077 JS, 13,788 CSS). The 2,000-byte
allowance keeps roughly 1,923 bytes of headroom; no dependency, font or vendored
asset is added. The bottom panel mounts only when its tab is active, and the
active-editor event is user-driven, so the change adds no eager frame or polling
loop.
