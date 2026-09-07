# NodeSim project review

Reviewed 2026-09-07 against clean `main` at `4215933`, followed by the local
changes described below. **Recommendations are proposed, not approved roadmap
commitments.** The [approved ADR](adr/0001-product-semantics.md) remains the
semantic authority; the [roadmap](AUDIT_REMEDIATION_ROADMAP.md) retains stage gates.

## Assessment and scope

This is a useful browser prototype with substantial working foundations:
validated authored documents, deterministic legacy migration, strict formula
parsing, typed monthly simulation, localized graph diagnostics, explicit command
history, scoped nested navigation, and a usable toolbar/semantic tree. The
house-fund demo computes savings `1500`, adjusted savings `1350`, and target month
`43`. There is no backend or account service. Browser storage and JSON downloads
are the durability boundary.

The review followed startup/recovery, node editing and connection creation,
formula/asset/custom computation, nested navigation, import/export and history,
workspace responsiveness, and verification/release scripts. It inspected the
implementation and existing tests, exercised selected browser workflows, and
reviewed all active project docs. It was not an exhaustive engine, security,
accessibility, or release audit. No dependencies, CI workflows, schema, persistence
semantics, or approved requirements were changed.

Production and financial-decision use remain **NO-GO**. Passing local checks does
not close recovery gaps, the approved precision requirement, manual accessibility,
current advisory review, hosted-CI, or real deployment/rollback acceptance.

## Completed in this pass

- Fixed `scripts/deployed-smoke.mjs`: verify referenced assets as well as files
  found on disk; handle single/double-quoted HTML references; reject normalized
  paths outside the base; reject unsupported/missing CLI arguments. `--url` can
  no longer silently produce localhost evidence. Failure closes the server and
  reports a nonzero result. Added focused subprocess regressions.
- Extended `scripts/lint.mjs` to include `scripts/` and Node syntax checks for
  `.mjs`, using the existing command and no new dependency.
- Added root [AGENTS.md](../AGENTS.md) with authority boundaries, code map,
  supported commands, evidence limits, and project-specific pitfalls.
- Refreshed README, product guide, release runbook, and roadmap status. Marked
  original audit/ADR observations as historical while preserving their decisions.
  Corrected the compact breakpoint (1100 px), connection-port workflow, signed
  income behavior, coverage scope, and local-only smoke claims.

## Verification receipt

Environment: Windows, Node `v24.18.0`, npm `11.16.0`, existing locked dependencies.

| Check | Actual result |
| --- | --- |
| Baseline `npm.cmd run ci:verify` | PASS in permitted host context: 11 files / 93 tests; typecheck, lint, coverage, dependency-major gate, build, bundle budget, local path/header smoke. |
| Restricted-account baseline | All 93 assertions passed, but the command failed writing `node_modules/.vitest/results.json` with EPERM. This was an execution-context failure; no permissions or test settings were changed. |
| New smoke regressions before the fix | Reproduced false passes for missing/escaped assets and unsupported/missing options. A wrong-title failure also exposed an abnormal Windows process exit; explicit error handling now exits normally. |
| Focused smoke regressions after the fix | PASS; final full-suite result recorded below. |
| Final `npm.cmd run ci:verify` | PASS: 12 files / 101 tests (also passed under coverage); typecheck, expanded lint, dependency-major gate, production build, all bundle budgets, local path/header/reference smoke. |
| Final coverage | 92.23% transformed bytes / 82.4% functions across 9 core modules; required thresholds remain 80% / 80%. |
| Final benchmark (normal test run) | 4,000-node compute 11.21 ms against 750 ms; 1,000-node, 25 move/Undo/Redo rounds 54.30 ms against 3,000 ms. No rendered performance claim. |
| Final build/bundle | 81 modules; total raw 781,850 / 870,400 bytes, JS raw 757,790 / 819,200, JS gzip 238,979 / 256,000, CSS raw 23,334 / 40,960. Existing Vite >500 kB advisory and transitive `pathe` / `react-is` notices remain visible. |
| Lint failure probe | PASS in permitted host context: a temporary invalid `.mjs` file under `scripts/` was rejected with a syntax error, then removed. |
| Documentation/diff hygiene | PASS: 38 local links/anchors across 7 active documents; `git diff --check` clean after correcting one Markdown hard-break whitespace issue. Final diff reviewed; unrelated files and historical evidence unchanged. |
| `node scripts/license-check.mjs` (offline) | FAIL: 22 absent optional platform manifests, plus `caniuse-lite@1.0.30001765` with non-allowlisted `CC-BY-4.0`. See R7. No registry requests were made by this script. |
| Browser, isolated `127.0.0.1:5187/NodeSim/` | Demo, valid numeric edit (income 4100 → savings 1600, adjusted 1440, target month 40), Undo/Redo, autosave/reload, keyboard Value creation, and compatible value connection passed. Custom-port rejection and nested-result mismatch reproduced. |
| Rendered spot checks | Compact tabs at 1100 px; 390 px screenshot inspected with document scroll width 390. Captured browser warnings/errors: none. These are spot checks, not a repeat of the entire Stage 7 matrix or manual accessibility acceptance. |

The original [Stage 7](../artifacts/stage-7/README.md) and
[Stage 8](../artifacts/stage-8/GO-NO-GO.md) receipts were left unchanged.

Not rerun: clean install, hosted GitHub workflows, live advisory/outdated queries,
real HTTPS origin/TLS/header/cache checks, production rollback, manual screen
reader/file picker, or a browser JSON-file round trip. Existing core tests cover
candidate rejection, migration, nested export/reimport, and storage recovery.
Existing release artifacts were not repackaged or overwritten.

## Best next three actions

1. **R1: harden recovery**, because user-authored work is the highest-impact
   boundary. Begin with fault-injection tests and current/temporary revision
   selection; address unavailable storage and pending edits without silently
   replacing recoverable data. Decide how competing tabs should be handled before
   implementing cross-tab writes.
2. **R2: complete custom-port transactions**, because a visible core authoring
   command currently cannot succeed. Start with selecting an existing compatible
   binding and committing the complete port in one command; no schema relaxation
   or automatic node creation is needed.
3. **R3: make nested inspection trustworthy**, so visible results and diagnostics
   agree with the root instance. Confirm whether nested views should display live
   instance results or an explicitly labeled isolated preview before implementing.

If packaging is the next task, do **R4 before creating another candidate**.
Decimal representation/rounding and deployment hosting also need decisions before
their respective implementations. None of these decisions blocks ordinary local
development or the completed fixes in this review.

## Prioritized recommendations

Effort is approximate focused engineering time, including relevant verification,
not a delivery commitment. P1 means high-impact core/release work; P2 means a
useful follow-up. Each item states the evidence boundary.

### R1 Recovery and storage failures

**P1 · 2–4 days · source-confirmed gaps; happy-path recovery passes.**
`GraphDocumentStorage.load()` in `src/document/documentStorage.ts` returns a
valid current record before considering a newer valid temporary envelope.
Namespace fallback uses `??` before validation, so an invalid NodeSim record can
hide a valid legacy record at that tier. `App.tsx` reads document/workspace/theme
storage without catching access errors, writes workspace/theme outside the
autosave catch, and has no page-exit flush or storage-conflict listener.

This can lose the latest interrupted edit, prevent startup, or let tabs overwrite
each other's work. Start with fault-injected envelopes and write failures, then
choose the newest valid candidate within a defined namespace/revision policy,
surface degraded storage clearly, and preserve dirty state when save fails.
Address cross-tab ownership explicitly; do not auto-overwrite recovered bytes.
**Success:** newest recoverable work survives each interrupted write stage;
blocked/quota storage leaves an editable/exportable UI with a truthful warning;
pending edits and competing tabs have tested, documented behavior. Browser fault
injection and a cross-tab UX decision are required beyond the current unit tests.

### R2 Custom-port authoring

**P1 · 1–2 days · confirmed in code and browser.**
`InspectorPanel.addPort()` submits an empty binding; `GraphDocumentStore` and
`graphDocument.ts` reject it. In the demo, Add Input reports
`custom.inputBindings.<new-id>: must be a non-empty string` and adds nothing.
Independent type/binding edits can likewise be rejected before the user can
complete both fields. Malformed imported bindings are rejected before the
Inspector repair UI can display them.

Provide a small local draft for a port's type, identity, and compatible existing
binding, then commit one valid `update-custom-ports` command. Define a deliberate
repair entry point separately from strict import; never persist invalid partial
ports or silently synthesize nodes. **Success:** add/edit/remove input and output
ports, including type+binding changes, works by keyboard; Undo restores ports and
affected edges; the root document round-trips. Binding identity, connected-edge
compatibility, and explicit repair policy are the main risks.

### R3 Nested computation context

**P1 · 1–3 days · confirmed discrepancy in code and browser.**
`computeGraphInternal()` injects parent values into custom graphs, but the
adapter's `projectGraph()` / `runRecompute()` evaluates an opened internal graph
in isolation. `App.tsx` replaces the root snapshot with authored data during
navigation, losing inactive-scope derived values. The demo shows Adjusted `0`
inside Savings Adjuster while the root result is `1350`; root values disappear
from the semantic tree until returning.

Expose computed results keyed by graph scope from root evaluation and project
the requested instance into canvas/tree/Inspector. Keep derived values out of
the document store and avoid a second competing compute authority.
**Success:** two-level repeated-ID fixtures show consistent values and diagnostics
before/after navigation, edit, Undo, and import. Confirm live-instance inspection
versus an explicitly separate preview mode; preserve current root semantics.

### R4 Immutable release packaging

**P1 before any new candidate · 0.5–1.5 days · source-confirmed; destructive path not executed.**
`scripts/create-release.mjs` recursively removes `releaseRoot` before copying,
including a caller-provided `--output`. It can overwrite the preceding artifact
despite the runbook's immutability rule, and overlapping input/output paths are
not rejected. Source-revision/dirty overrides and a hard-coded base path also
make manifest provenance weaker than the release contract implies.

Reject existing destinations and unsafe/overlapping resolved paths before any
write; stage into a fresh directory and finalize only after successful copy and
hash verification. Define any historical-artifact metadata override explicitly.
**Success:** repeat packaging fails without altering old hashes; missing input,
copy failure, overlap, and invalid paths leave source/previous artifacts intact;
manifest base/revision describe the actual artifact. This is data-preservation
work, not a reason to delete or regenerate existing release evidence.

### R5 Approved money precision

**P1 before financial-decision use · 3–7 days after design · accepted requirement, unimplemented.**
`formula.ts` and `computeGraph.ts` use JavaScript numbers throughout. Finite checks
prevent NaN/infinity, but do not implement the ADR's deterministic decimal or
fixed-point money. `0.1 + 0.2`, repeated interest, and threshold comparisons need
a defined rounding/precision contract before this becomes decision-support software.

First decide money scale, rounding points/mode, rates, and mixed scalar/flow
behavior; then implement at the existing typed engine seam with exact reference
fixtures and document-migration analysis. **Success:** deterministic boundary and
long-horizon results under the approved rules, compatibility documented, product
acceptance recorded. Do not substitute display rounding for the numeric contract
or choose a dependency before the representation decision.

### R6 Real-origin release proof

**P1 for production · 1–2 days plus owner access · missing capability/evidence.**
`deployed-smoke.mjs` only serves local files and supplies the expected headers
itself. The candidate Pages URL has not been verified against
`deployment/security-headers.json`; no real-origin verification command exists.
The current release runbook therefore cannot yet prove the HTTPS target or
production rollback using repository tooling alone.

Choose/verify a host capable of the header contract, then add an explicit
read-only real-origin mode with asset, redirect, TLS, header, and cache checks.
Keep synthetic local evidence distinctly labeled. **Success:** an authorized
clean candidate and its preceding immutable artifact both pass at the actual
target, with logs bound to their hashes. Requires hosting/authorization decisions,
R4, hosted CI, dependency review, and manual gates; no deployment is authorized
by this recommendation.

### R7 Dependency-review signal

**P2; required before release gate use · 0.5–1 day plus license review · confirmed offline failure.**
`scripts/license-check.mjs` iterates every lockfile package and requires a local
manifest even for optional packages incompatible with Windows. The current run
reports 22 absent platform manifests and flags `caniuse-lite`'s `CC-BY-4.0`.
The existing dependency workflow also requires `npm outdated` to return success,
so its policy is stricter than merely reviewing outdated versions.

Distinguish expected platform omissions from missing required installations;
keep genuine unknown/non-allowlisted licenses visible for review. Decide whether
outdated packages require upgrades or a documented review outcome. Preserve the
current advisory gate and avoid unsafe transitive overrides for `pathe`/`react-is`.
**Success:** a clean supported-platform install produces actionable license
findings, required missing packages still fail, and authorized registry review
has an explicit result/exception policy. No live advisory status was established.

### R8 Repeatable browser and accessibility verification

**P2; manual acceptance remains a release gate · 1–3 days plus human checks · coverage gap.**
`vitest.config.ts` runs Node tests; `controllerLifecycle.test.ts` uses `FakeGraph`.
`scripts/coverage.mjs` includes core `.ts`, excludes `.tsx`, and does not require
the real controller. Stage 7 contains JSON/screenshots but no checked-in browser
runner. Thus passing CI does not cover the port and nested-view defects above.

Retain a small reproducible browser regression path for add/connect, fields,
scope changes, file import/export, history, reload, and desktop/compact remount.
Extend it as R1–R3 are repaired; avoid duplicating core engine assertions in UI
tests. **Success:** one documented local command reproduces these workflows and
captures useful failures; manual screen-reader and OS-picker results remain
separate. At 390 px the canvas is heavily fitted down, so assess label readability
and the semantic alternative with real users rather than inferring it from no overflow.

### R9 Numeric-draft feedback

**P2 · 0.5–1 day · confirmed in browser.**
`NumericDraftField.tsx` commits on blur, sets `isEditing` false, then restores the
authored value even when validation failed. Entering `-` for income and tabbing
away shows `4000` with “must be a finite number.” Parent command rejection also
has no success/failure result in the `onCommit` contract.

Define one draft/commit outcome for blur, Enter, Escape, external Undo, and scoped
selection changes. Preserve a rejected draft with its error or clearly announce
restoration without labeling the restored valid value invalid. **Success:** the
visible value, error association, and authored document agree through those
transitions. Verify the shared field in both Inspector and horizon controls;
this should follow a focused UI test path rather than a one-off effect tweak.

### R10 Reduce repeated editor work before larger refactors

**P2 · 1–2 days · source-confirmed opportunity; rendered cost not measured.**
`App.tsx` evaluates `graphDocumentToRuntimeGraph(...)` and constructs a new
`GraphDocumentStore(...)` in `useRef` arguments on every render, though React
retains only the initial ref values. Every command clones/validates the root,
and the adapter removes/recreates all rendered elements and fits the canvas.
Connection candidate validation recomputes the graph per candidate. Existing
benchmarks measure engine/store work, not these rendered costs.

Profile a representative connected/nested document, first make one-time
initialization lazy, then remove demonstrated duplicate work using existing
store/engine/adapter boundaries. **Success:** selection/field editing does not
construct unused stores; measured interactions improve without stale derived
state, lost pan/zoom, or history changes. Avoid broad module splitting, new
state layers, or caching frameworks until measurements justify them.
