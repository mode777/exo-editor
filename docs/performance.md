# Performance budgets

Status: budgets are recorded for the `release-readiness` change. The deployed
measurements are filled in [Results](#results) at task 8.4. The bundle budget is
the only performance gate that runs in CI; the runtime budgets are a release
checklist item performed manually against the deployed site.

## Budgets

| Budget | Ceiling | Measurement |
| --- | --- | --- |
| Plugin frame startup | 2,000 ms | Open a matching file in the demo workspace, measure until the reference code plugin's Monaco surface is visible and focusable |
| 10k-entry directory listing | 3,000 ms total, 1,000 ms longest task | Expand a directory with 10,000 entries and measure until every row is painted |
| 1 MiB file open | 1,000 ms | Shell text surface and reference code plugin, from activating the file to the editable surface |
| 1 MiB file save | 1,000 ms | Shell text surface and reference code plugin, from Save to the shell's success state |
| Shell bundle (JS) | 152,000 gzip bytes | `npm run budget` / CI `Bundle budget` |
| Shell bundle (CSS) | 14,000 gzip bytes | `npm run budget` / CI `Bundle budget` |

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
3. Warm up once: open and close a `.ts` file, expand the 10k directory and open
   and save a 1 MiB file.
4. Run each measurement five times with the same setup; record every run. Use
   `performance.now()` from navigation or the action start, and
   `PerformanceObserver` long-task entries for the listing.
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

| Budget | Median | Maximum | Ceiling | Result | Date |
| --- | --- | --- | --- | --- | --- |
| Plugin frame startup | pending | pending | 2,000 ms | pending | pending |
| 10k listing total | pending | pending | 3,000 ms | pending | pending |
| 10k listing longest task | pending | pending | 1,000 ms | pending | pending |
| 1 MiB open - shell text | pending | pending | 1,000 ms | pending | pending |
| 1 MiB save - shell text | pending | pending | 1,000 ms | pending | pending |
| 1 MiB open - code plugin | pending | pending | 1,000 ms | pending | pending |
| 1 MiB save - code plugin | pending | pending | 1,000 ms | pending | pending |

Deployed commit and measurement environment: recorded with the results at task
8.4 so the table and `ROADMAP.md` evidence cannot disagree.

## Bundle budget

The committed budget lives in `apps/shell/budget.json` and is measured before the
template and code-plugin copies, so it continues to describe the shell only. The
CI steps are `node apps/shell/scripts/check-bundle-budget.mjs apps/shell/dist
apps/shell/budget.json` in the `verify` job. A change that needs a larger budget
must update the file and explain why in the change; the runtime budgets above are
independent of it.
