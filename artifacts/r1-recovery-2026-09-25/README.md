# R1 recovery verification — 2026-09-25

Scope: the first unfinished item in `docs/PROJECT_REVIEW.md`, R1 recovery and
storage failures. R2 and later recommendations were not implemented. The working
tree was clean at entry; no commit, push, packaging, publish, or deployment was
performed. Earlier Stage 7/8 artifacts remain unchanged.

## Implemented policy

Load all record tiers independently, prefer valid NodeSim data over legacy data,
and select the highest revision within that namespace. Equal revisions prefer
current, temporary, last-known-good. Loading never writes. Before reusing a
temporary slot, preserve and verify the latest recoverable envelope as last-good.

For competing tabs, pause autosave on an external document change; keep local
editing/export available. Serialize cooperating tabs with Web Locks and check
record identity before writing. Explicit loading resumes from saved data, with
local work retained in Undo. Unreadable/invalid saved bytes and browsers without
Web Locks cannot silently fall through to unprotected writes.

## Results

Environment: Windows, Node `v24.18.0`, npm `11.16.0`, locked existing dependencies.
Browser: headless Chromium `151.0.7922.34` from the available Playwright runtime.

| Check | Result |
| --- | --- |
| Recovery fault regressions against original code | Seven failures reproduced after validating the test fixture: newer temporary selection, invalid namespace masking, interrupted write preservation, and corrupt readback handling. |
| Focused storage/session/integrity tests | 39 passed across 3 files. |
| Final `npm.cmd run ci:verify` | PASS: typecheck, lint, 14 files / 128 tests, coverage, dependency-major gate, build, bundle budget, local artifact smoke. |
| Coverage | 92.57% transformed bytes / 82.59% functions across 10 exercised core modules; existing 80% thresholds unchanged. No React coverage claim. |
| Final normal-suite benchmark | 4,000-node computation 24.01 ms / 750 ms; 1,000-node 25 move/Undo/Redo rounds 155.59 ms / 3,000 ms. |
| Final bundle | Raw total 787,821 / 870,400 bytes; JS raw 763,186 / 819,200; JS gzip 240,743 / 256,000; CSS raw 23,909 / 40,960. |
| Browser fault injection | PASS: [machine receipt](receipt.json), including downloads, recovery, blocked getter, quota/retry, real tab conflict, reload/Undo, pending-edit lifecycle handlers, missing Web Locks, and no page/console errors. |
| Rendered inspection | Inspected [1440 px dark desktop](blocked-desktop.png) and [390 px light compact](quota-compact.png). Warning and recovery actions are readable; compact document scroll width is 390 px. Export remains available while a different compact tab is selected. |
| Diff hygiene | `git diff --check` passed. |

Restricted-account execution initially encountered existing Vitest-cache EPERM and
artifact-directory access failures. The checks ran successfully in the permitted
host context; no machine permissions, dependency versions, or test settings were
changed. Vite's existing large-chunk advisory and transitive `pathe`/`react-is`
notices remain visible.

## Reproduction and evidence limits

Use the [runbook command](../../docs/RELEASE_OPERATIONS.md#recovery-browser-verification)
with a dedicated loopback origin. This run used
`http://127.0.0.1:5197/NodeSim/` and fresh browser contexts, leaving existing
browser documents untouched. The browser runner uses an external Playwright
installation; it does not install dependencies or run as part of hosted CI.

Unload and pagehide were dispatched to verify the actual registered lifecycle
handlers. This is not an OS-close dialog or forced-process crash test. Numeric
drafts warn before unload but remain outside the authored/exported document until
Enter or blur. Browser final writes and prompts remain best effort; changes can
be lost if a process dies before the 250 ms debounce completes. Concurrent-write
exclusion covers cooperating current-version tabs, not old code or external
writers. Export is still the portable durability path.

Not claimed: complete browser/keyboard authoring coverage, manual screen-reader
or OS-picker acceptance, live advisory/license review, hosted CI, a real deployed
origin, production rollback, or financial-use acceptance. Production remains
NO-GO under the existing roadmap gates.
