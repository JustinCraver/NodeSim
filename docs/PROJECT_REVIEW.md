# NodeSim project review

Reviewed 2026-09-07 against clean `main` at `4215933`, followed by the local
changes described below. **Recommendations are proposed, not approved roadmap
commitments.** The [approved ADR](adr/0001-product-semantics.md) remains the
semantic authority; the [roadmap](AUDIT_REMEDIATION_ROADMAP.md) retains stage gates.

Follow-up 2026-09-25: R1 recovery remediation is complete, with its own receipt
under R1 below. The original review verification table remains dated evidence.

Follow-up 2026-10-02: R2 custom-port authoring is complete within the bounded
engineering scope below. R3 is now the first unfinished recommendation.

Follow-up 2026-10-02 (all unfinished items requested): R4, R9, and the bounded R10
engineering work are complete locally. R6's read-only verifier, R7's platform-aware
license reporting, and R8's consolidated browser command are implemented; their
external/product/manual gates remain explicit. The precision design is proposed,
not approved. Work includes uncommitted changes on `main` from clean baseline
`3edb13a5b44ddb5d3276a600987901bc663d192b`.

| Item | Current completion boundary |
| --- | --- |
| R3 | Pending owner choice: live instance inspection or isolated preview; no implementation decision assumed. |
| R4 | Completed: staged/hash-verified packaging, exclusive destination creation, build provenance, unsafe-path/override rejection. |
| R5 | [Precision contract](adr/0002-money-precision.md) prepared; explicit owner approval, implementation, and product acceptance pending. |
| R6 | Verifier implemented and fault-tested. Actual host/candidate/preceding artifact proof, hosted CI, and authorized deployment/rollback pending. |
| R7 | Platform omission reporting fixed. `CC-BY-4.0` owner review and authorized current registry/hosted review pending; upgrade-required outdated policy retained. |
| R8 | One local browser command covers recovery, ports, numeric fields, general authoring/files/history/reload/remount. R3 live-context assertions and human screen-reader/OS-picker/readability acceptance pending. |
| R9 | Completed: rejected drafts retain text/error; parent rejection, cancellation, external revisions, and scoped selection verified in the real UI. |
| R10 | Completed: measured lazy initialization, stable same-scope elements/viewports, and selection without graph reprojection; exact history/export verified. |

The [follow-up receipt](../artifacts/review-2026-10-02/README.md) preserves failures,
verification, performance measurements, and pending decisions. No dependencies or
lockfile, approved semantics, hosted workflows, or existing release artifacts were
changed. No commit, push, publication, or deployment occurred.

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

R1/R2 and the local R4/R9/R10 tasks were implemented in their dated passes. The
next unfinished decisions/gates are:

1. **R3: make nested inspection trustworthy**, so visible results and diagnostics
   agree with the root instance. Confirm whether nested views should display live
   instance results or an explicitly labeled isolated preview before implementing.
2. **R5: approve or revise the proposed precision contract**, then implement its
   exact engine and document/migration requirements.
3. **R6/R7/R8: supply the remaining external acceptance**, including a suitable
   authorized host, clean hosted CI, current dependency/license review, and human
   accessibility results before deployment/rollback proof.

R4 now enforces a fresh destination and the production build's recorded metadata.
Decimal representation/rounding and hosting still need decisions. Ordinary local
development and verification can continue while those choices are pending.

## Prioritized recommendations

Effort is approximate focused engineering time, including relevant verification,
not a delivery commitment. P1 means high-impact core/release work; P2 means a
useful follow-up. Each item states the evidence boundary.

### R1 Recovery and storage failures

**Completed 2026-09-25: recovery/storage engineering scope.** Original gaps were
current-before-temporary selection, namespace fallback before validation,
unguarded browser storage access, and missing pending-edit/tab conflict handling.

- Recovery validates every tier, chooses the highest valid revision within
  NodeSim, then falls back to independently validated EconGraph records. Ties
  prefer current, temporary, last-known-good. Loading never rewrites records.
- Saves preserve and verify the latest recoverable envelope before reusing
  temporary, then verify exact write readbacks. Failed writes remain dirty;
  unreadable/unrecoverable records cannot be replaced by fallback-demo autosave.
- Storage getter/read/quota failures leave editing, root JSON downloads, theme,
  and workspace controls usable with a persistent warning and explicit retry.
- Cross-tab policy: serialize writes with Web Locks, compare the loaded records,
  and pause autosave on external changes. Local edits remain editable/exportable.
  Explicit **Load saved version** resumes from saved data and retains local work
  in Undo. No automatic merge or force overwrite is offered; browsers without
  Web Locks use export instead of shared document writes.
- Pending accepted edits flush on hidden visibility/pagehide/beforeunload.
  Unsaved authored changes and uncommitted numeric drafts trigger unload
  protection. Listener/timer cleanup prevents callbacks and queued writes after
  teardown. Numeric-draft validation behavior in R9 is unchanged.

Verification and rendered evidence are retained in the
[R1 receipt](../artifacts/r1-recovery-2026-09-25/README.md), with a reproducible
[browser command](RELEASE_OPERATIONS.md#recovery-browser-verification).
Fault regressions reproduced seven original failures before the fix. Tests cover
interrupted write stages, corrupt readbacks, namespace/revision selection,
blocked reads, quota/retry, competing writers, pending edits, and cleanup.

This closes the bounded R1 implementation task, not production or manual
accessibility acceptance. Browser unload prompts/final asynchronous writes are
best effort; a forced crash before the debounce completes can lose in-memory
changes. Coordination covers tabs using the current lock protocol, not older
app versions or external writers. Export remains the portable durability path.

### R2 Custom-port authoring

**Completed 2026-10-02: bounded custom-port authoring and explicit repair.**

- Add/Edit drafts collect identity, label, type, and a compatible existing binding
  before one strict `update-custom-ports` command. Existing port IDs stay fixed;
  output formula identities remain explicit and unique. Rejected drafts remain
  editable with their validation error, without changing document/history/storage.
- Removing ports removes their attached edges; type changes remove only newly
  incompatible attached edges. Compatible edges remain. Undo/Redo restores the
  complete transaction, including bindings and affected connections.
- Binding pickers use authored type inference, including arithmetic and asset
  series outputs. Legacy conversion now infers only omitted port types, preserving
  explicit declarations through subsequent commands and JSON round trips.
- Internal-graph JSON has an explicit binding-repair preview/action. Preview
  changes no authored data; applying adds typed zero-value placeholders and
  commits graph plus bindings in one undoable command. Ordinary Open remains
  strict and never repairs malformed bindings implicitly.
- Drafts reset on selection/scope changes and accepted document revisions, with
  focus restoration after Apply/Cancel/Escape and unload protection while open.
  Semantic port rows use authored IDs even when labels repeat. Alt+Enter on the
  focused Create connection button now invokes one command instead of both its
  button and dialog handlers.

Verification: final `npm.cmd run ci:verify` PASS, 14 files / 136 tests, coverage
93.48% transformed bytes / 85.82% functions; typecheck, lint, dependency-major
gate, production build, all bundle budgets, and local path/reference/header smoke.
The [R2 receipt](../artifacts/r2-custom-ports-2026-10-02/README.md) retains the
original failures, corrected browser runs, and inspected screenshots. Its focused
[browser command](RELEASE_OPERATIONS.md#custom-port-browser-verification) passed
the real React/controller keyboard workflows at 1440 px and 390 px, including
type+binding changes, port/edge Undo, strict rejection, root JSON file round trips,
explicit repair, focus, and nested repeated IDs, with no console/page errors.

This closes R2's implementation task. Nested live-instance results (R3), the broader
R8 matrix, manual accessibility/OS-picker checks, precision, hosted CI, dependency
review, and deployment/release acceptance remain open. No schema version or
approved computational semantics changed; no commit, push, package, or deployment
was performed.

**Original finding (2026-09-07), retained for context:**
`InspectorPanel.addPort()` submits an empty binding; `GraphDocumentStore` and
`graphDocument.ts` reject it. In the demo, Add Input reports
`custom.inputBindings.<new-id>: must be a non-empty string` and adds nothing.
Independent type/binding edits can likewise be rejected before the user can
complete both fields. Malformed imported bindings are rejected before the
Inspector repair UI can display them.

The recommendation was to provide a small local draft for a port's type,
identity, and compatible existing binding, then commit one valid
`update-custom-ports` command. Define a deliberate
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

**Completed 2026-10-02: bounded packaging engineering.** Packaging validates paths,
source/provenance, version, and production base before writes; rejects existing
destinations (including empty directories), links, overlaps, reserved/invalid
path segments, unknown/duplicate arguments, and metadata overrides. Copying occurs
in a fresh stage; input and staged hashes must still match before exclusive
destination creation. The manifest is finalized last. Failures remove only this
run's owned stage/reservation, preserving earlier artifacts.

`npm run build` records actual base/version/Git revision/dirty state and file
hashes in `nodesim-build.json`. Packaging requires that receipt and rejects changed
or extra files. `SHA256SUMS` now also binds the release manifest. Historical
metadata overrides are unsupported; retain preceding artifacts with their original
receipts. Twenty-six subprocess/fault tests cover preservation, copy faults,
competing writers, provenance, and invalid paths. Existing retained releases were
neither repackaged nor overwritten. A dirty local build remains validation only.

**Original finding (2026-09-07), retained for context:**

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

**Design prepared 2026-10-02; owner decision still required.**
[ADR 0002](adr/0002-money-precision.md) proposes BigInt fixed point, 12 fractional
places for scalars/rates, cents for money, symmetric half-even rounding, explicit
rounding boundaries/range, and a deliberate v2 upgrade retaining v1 calculations.
It includes exact reference cases and migration/acceptance requirements. Approval
was requested; no answer was assumed and no dependency or numeric/schema contract
was changed. Implement only after the decision is recorded.

Preparation continued on 2026-10-02: the [migration analysis](MONEY_PRECISION_MIGRATION.md)
maps the current numeric/schema/store/UI seams, confirms an old-reader/new-schema
storage risk in disposable memory, and proposes separate v2 storage slots. An
independent Fraction/Decimal design oracle agrees on 2,418 monthly samples,
including two 1,200-month cases and explicit range/divisor controls. The actual
v1 engine observation retains the threshold difference (month 11 versus proposed
month 10 for tenths contributions). These are draft design/compatibility evidence,
not product approval, a new engine implementation, or financial acceptance.

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

**Verifier engineering implemented 2026-10-02; release proof remains pending.**
`npm run verify:origin -- --url <https-origin>/NodeSim/ --artifact <release-dir>
--output <fresh-receipt.json>` verifies a clean, locally hash-bound release,
HTTP-to-HTTPS redirect, authorized TLS, same-origin/path redirects, every manifest
file's bytes/hash, entrypoint references, exact response headers, resource cache
policy, and conditional revalidation. The read-only command preserves existing
receipts and rejects output inside the immutable artifact. Requests and the run
have bounded deadlines; TLS disabling is rejected. Sixteen mock-transport/CLI
fault tests are engineering evidence only.

The [read-only target observation](../artifacts/review-2026-10-02/pages-origin-observation.json)
returned HTTP/HTTPS 404 and no matching header contract at the documented Pages
URL. It tested no candidate and grants no host acceptance. Local smoke receipts
are labeled `synthetic-local`. The host decision, clean hosted candidate and
preceding immutable artifact, dependency/manual gates, authorized publication,
and production rollback proof remain open. Historical lists without a manifest
hash cannot satisfy the new verifier; do not retrofit or regenerate them.

The [native transport receipt](../artifacts/review-2026-10-02/native-transport-2/receipt.json)
additionally verifies real loopback HTTP/TLS requests, process-local fixture trust,
rejection of an independent untrusted certificate, the 5 MiB streaming limit, and
a wall deadline during continuous streaming. Temporary certificates/keys and
servers were cleaned; no machine trust store or production TLS setting changed.
This strengthens transport engineering evidence while remaining a local fixture;
the actual target/candidate/rollback requirements above are still pending.

**Original finding (2026-09-07), retained for context:**

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

**Offline reporting engineering completed 2026-10-02; review acceptance pending.**
The license command separates missing optional packages whose lockfile OS/CPU
constraints exclude this host. Required/applicable missing packages, malformed
manifests, installed-version mismatches, and unknown/nonallowlisted licenses
still fail. Nine fixture regressions protect those distinctions. The current
Windows installation reports 122 installed manifests, 22 expected omissions,
and one remaining failure: `caniuse-lite@1.0.30001765: CC-BY-4.0`. No allowlist
expansion, dependency upgrade, clean install, or registry review is implied.

The existing release policy remains **upgrade required** for outdated packages:
`npm outdated` finding updates fails the authorized dependency workflow. The
high/critical advisory gate is unchanged. Unknown/nonallowlisted licenses require
owner review. There is no implicit exception; any desired exception needs an
explicit owner-approved policy with scope, rationale, expiry, and retained
evidence before the gate changes. Live registry/hosted results and license
acceptance remain required; no current advisory status is claimed.

**Original finding (2026-09-07), retained for context:**

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

**Repeatable local path implemented 2026-10-02; human/R3 acceptance pending.**
`npm run browser:verify -- <dedicated-loopback-NodeSim-URL> <fresh-output-directory>`
runs the existing recovery and custom-port suites plus shared numeric-draft and
general authoring suites. Each uses fresh browser contexts; the aggregate command
rejects existing output directories, requires passing retained subreceipts, stops
on failure, and preserves useful failure screenshots/receipts. General workflows
cover keyboard add/connect/fields, rejected candidates, nested authored edits,
exact root file exports/imports/history, actual autosave/reload, and desktop/390 px
remount. Connection pickers and numeric fields now have stable visible-label
associations. See the [runbook](RELEASE_OPERATIONS.md#consolidated-browser-verification).

This is optional Chromium local automation, separate from the Node-only coverage
gate and hosted CI. R3 live-instance consistency assertions must be added after its
decision/implementation. Manual screen-reader speech, native OS-picker behavior,
and real-user compact-label/semantic-alternative assessment remain human gates.

**Original finding (2026-09-07), retained for context:**

**P2; manual acceptance remains a release gate · 1–3 days plus human checks · coverage gap.**
`vitest.config.ts` runs Node tests; `controllerLifecycle.test.ts` uses `FakeGraph`.
`scripts/coverage.mjs` includes core `.ts`, excludes `.tsx`, and does not require
the real controller. Stage 7 contains JSON/screenshots. The later R1 pass adds a
focused optional recovery browser runner, but passing CI still does not cover
the port and nested-view defects above or the complete authoring matrix.

Retain a small reproducible browser regression path for add/connect, fields,
scope changes, file import/export, history, reload, and desktop/compact remount.
Extend it as R1–R3 are repaired; avoid duplicating core engine assertions in UI
tests. **Success:** one documented local command reproduces these workflows and
captures useful failures; manual screen-reader and OS-picker results remain
separate. At 390 px the canvas is heavily fitted down, so assess label readability
and the semantic alternative with real users rather than inferring it from no overflow.

### R9 Numeric-draft feedback

**Completed 2026-10-02: shared draft/commit engineering.** Invalid blur/Enter and
rejected parent commands preserve draft text with its associated error. Successful
commands normalize accepted text; Escape restores authored text and clears its
error. External authored revisions (including Undo/Redo) and scoped selection
changes discard local drafts consistently. Drafts stay outside exported/autosaved
documents. Visible label identity is stable while error text changes.

The original `-` → `4000` with a remaining error was reproduced before edits and
retained. The focused real React/controller runner passes desktop and 390 px
Inspector/horizon transitions, negative-expense parent rejection, history,
selection reset, and error association; screenshots were inspected. Aggregate
checks remain separately recorded in the follow-up receipt.

**Original finding (2026-09-07), retained for context:**

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

**Completed 2026-10-02: measured bounded editor optimization.** Initial graph/store
resources are lazy per mounted App. Same-scope hierarchy selection uses the current
projection without constructing/recomputing a replacement. Authored revisions
update stable Cytoscape elements, clear removed data, and recreate edges only when
endpoints change; scope changes still get a fresh layout. Same-scope field/history
edits preserve pan/zoom and use accepted document state.

The isolated 153-node connected/two-level fixture measured 44 unused stores in the
original selection/edit sequence, replaced node elements, and lost viewport state.
The final run keeps one store, stable node identity, and exact viewport/Undo/export
state; 11 selection actions add zero compute calls. Observed medians were selection
174.7 → 168.6 ms and editing 146.6 → 133.4 ms in this run. These are local samples,
not portable performance budgets. Existing full-root validation/history remain.
Candidate-type computation was not profiled into a new cache or weakened gate;
broader caching/module refactors remain unjustified by this measurement.

**Original finding (2026-09-07), retained for context:**

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
