# NodeSim Audit Remediation Roadmap

**Status:** Proposed  
**Audit date:** 2026-07-27  
**Current release assessment:** Prototype/demo GO; production and financial-decision use NO-GO

## Purpose

This roadmap turns the repository audit into a dependency-ordered remediation program. It prioritizes calculation correctness and protection of user-authored graph data before architecture, usability, performance, and release work.

Each stage is deliberately bounded and includes:

- scope;
- dependencies;
- acceptance gates;
- rollback boundaries;
- a standalone Codex kickoff prompt.

Passing one stage does not authorize beginning the next stage. Manual, product-decision, security, deployment, and rendered-UX gates remain pending until their required evidence exists.

## Audit Summary

NodeSim is a promising visual financial-modeling prototype. Its current happy-path demo computes consistently, strict TypeScript is enabled, the production build succeeds, and the formula implementation does not execute arbitrary JavaScript.

It is not production-ready because:

1. malformed formulas can silently produce materially incorrect results;
2. graph edits are lost on refresh or crash;
3. malformed imports can replace the active graph before validation completes;
4. exporting while inside a custom node exports only that internal graph;
5. graph errors can be masked downstream or assigned to unrelated nodes;
6. edge, time, and asset semantics are incomplete or hidden;
7. the persisted document mixes authored state with runtime and presentation caches;
8. core graph authoring is mouse-only and difficult to discover;
9. the workspace does not provide a viable compact-width layout;
10. generated output and installed dependencies are committed to source control;
11. there are no automated tests, linting, CI, deployment, or release gates;
12. dependency vulnerability status has not been verified against a current live advisory service.

### Confirmed Correctness Defects

Targeted engine probes reproduced the following:

| Input or condition | Current result | Required result |
| --- | --- | --- |
| `1$+2` | `3`, without an error | Reject the unknown character |
| `.5 + .25` | `30` | `0.75`, or a grammar error if leading decimals are intentionally unsupported |
| `1 / 0` | `Infinity`, serialized as `null` | Explicit division-by-zero error |
| `max(1,-2)` | Invalid function usage | `1` |
| A cycle plus an independent value node | Every node marked cyclic | Only actual cycle members and blocked dependents diagnosed |
| Weighted edge | Weight ignored | Implement the documented behavior or remove the unsupported field |
| Formula edit followed by reload | Edit lost | Recover the last valid authored document |

### Verified Baseline

- TypeScript check passed.
- Production build passed with 73 modules transformed.
- The initial JavaScript bundle measured 692.71 kB minified and 220.42 kB gzip.
- Vite emitted its over-500-kB chunk warning.
- Fresh build artifacts matched the committed `dist` files by SHA-256.
- The current demo produced:
  - net income: `4000`;
  - monthly savings: `1500`;
  - adjusted savings: `1350`;
  - target reached: month `43`.
- A rendered 390 px viewport produced a workspace approximately 1,190 px wide.
- Cytoscape emitted repeated warnings for unsupported shadow-style properties.
- Offline cached dependency audit reported zero findings across 99 dependencies, but this is not current live proof.

## Delivery Principles

All stages must follow these rules:

1. Start from the current repository state and inspect before changing.
2. Preserve unrelated work and persisted document compatibility.
3. Keep authored graph state separate from derived compute and presentation state.
4. Add characterization coverage before refactoring behavior.
5. Treat calculation errors and data-loss risks as release blockers.
6. Do not let automation substitute for required product, accessibility, security, or deployment review.
7. Do not commit, push, publish, deploy, rewrite Git history, or open a pull request unless separately authorized.
8. Report exact commands, results, artifacts, and blockers at the end of every stage.

## Roadmap Overview

| Stage | Outcome | Primary gate | Rollback boundary |
| --- | --- | --- | --- |
| 0. Repository baseline | Clean source tree and pinned toolchain | Clean checkout/install/typecheck/build | Revert the hygiene change; do not rewrite history |
| 1. Semantics and characterization | Approved product contract and regression harness | ADR approval and passing characterization tests | Documentation and test-only boundary |
| 2. Document integrity and recovery | Versioned schema, atomic I/O, autosave, and recovery | Invalid input never mutates; root document round-trips | Legacy reader and last-good record retained |
| 3. Computation correctness | Strict formulas and structured graph diagnostics | Adversarial formula and graph suite passes | Parser and engine changes isolated behind tests |
| 4. Typed simulation semantics | Explicit value, port, edge, and time behavior | Dimensional and boundary fixtures pass | Versioned legacy migration retained |
| 5. Nested custom graphs | Scoped navigation and actionable nested diagnostics | Two-level nested round-trip passes | One-level navigation retained until replacement is proven |
| 6. State, history, and lifecycle | Authoritative store, undo/redo, cleanup, and performance budget | Undo and remount tests pass | Cytoscape projection adapter remains reversible |
| 7. Accessible responsive UX | Discoverable authoring across input modes and widths | Keyboard, accessibility, contrast, console, and width gates pass | Prior layout preset and theme tokens retained |
| 8. CI and release proof | Reproducible release, security review, deployment, and rollback | Deployed-path smoke test and artifact rollback pass | Redeploy preceding versioned artifact |

---

## Stage 0 — Repository and Toolchain Baseline

### Objective

Create a clean, reproducible source tree before adding behavioral changes.

### Scope

- Inspect the current Git state, deployment clues, package metadata, and generated files.
- Add an appropriate `.gitignore`.
- Remove `node_modules`, `tsconfig.tsbuildinfo`, and normally `dist` from the Git index while preserving local working copies.
- Retain `package-lock.json`.
- Verify whether committed `dist` is required by an actual deployment contract before removing it.
- Pin and document the supported Node/npm toolchain.
- Add explicit `typecheck` and aggregate verification scripts.
- Make the default Vite development server loopback-only.
- Add an explicit, documented LAN opt-in command when needed.
- Do not rewrite repository history.

### Acceptance Gate

- Generated/vendor paths return zero results from `git ls-files`, unless a documented deployment exception exists.
- A clean dependency install succeeds using the pinned toolchain.
- Typecheck and production build pass from a clean checkout.
- Default development server is local-only.
- Git status contains only the intentional Stage 0 changes.

### Rollback

Revert the Stage 0 change. Any future Git-history purge is a separate destructive operation requiring explicit coordination and authorization.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 0: repository and toolchain baseline, then stop.

Begin by inspecting Git status/history, package.json, package-lock.json, deployment clues, and tracked generated files. Preserve all unrelated work and existing commits; do not rewrite history, commit, push, or open a PR.

Add an appropriate .gitignore. Remove node_modules, tsconfig.tsbuildinfo, and normally dist from the Git index while preserving local working copies. First verify whether committed dist is required by a real deployment contract; if so, document the exception instead of guessing. Retain package-lock.json. Pin and document a supported Node/npm toolchain, add explicit typecheck/check scripts, and make the default Vite dev server loopback-only with an explicit documented LAN opt-in.

Verify a clean dependency tree, typecheck, production build to temporary output, and clean Git status. Report exact file counts before/after, commands, results, and any environment-only blockers. Keep history cleanup out of scope.
```

---

## Stage 1 — Product Semantics and Characterization

### Objective

Define the intended domain contract and protect the current valid behavior before refactoring.

### Scope

- Add a deterministic test harness.
- Characterize every node kind and time-unit conversion.
- Retain a fixture for the current house-fund demo.
- Characterize custom inputs, outputs, bindings, and document round trips.
- Record confirmed defects as pending target tests without leaving the test suite red.
- Create an architecture decision record covering:
  - formula grammar;
  - finite-number policy;
  - expense sign convention;
  - scalar, monthly-flow, and timeseries values;
  - edge weight and lag policy;
  - asset initial balance and contribution timing;
  - simulation horizon;
  - output/unreachable semantics;
  - multi-output formula identifiers;
  - nested graph identity;
  - persistence and recovery guarantees.

### Acceptance Gate

- Characterization tests pass for every supported node kind.
- The house-fund fixture retains the approved values.
- Confirmed defects are represented as target coverage.
- The ADR clearly distinguishes behavior to preserve from behavior to change.
- Product-impacting ADR decisions are reviewed before Stage 2 begins.

### Rollback

Stage 1 should be limited to documentation and test infrastructure. Revert those additions without changing production behavior.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 1: semantics ADR and characterization tests, then stop. Preserve unrelated changes; do not commit, push, or begin schema/engine remediation.

Inspect the current demo, types, computeGraph, custom-node behavior, and import/export format. Add a deterministic test harness and passing characterization tests for every node kind, time-unit normalization, the current house-fund demo, custom ports, export round trips, and current documented errors.

Create an ADR defining the intended formula grammar; finite-number policy; expense sign convention; scalar/monthly-flow/timeseries types; edge weight/lag policy; asset initial balance, contribution timing, horizon, and output semantics; multi-output formula identifiers; nested scope identity; and persistence/recovery guarantees. Clearly distinguish behavior to preserve from confirmed defects. Record confirmed defects as pending target tests without leaving CI red.

Run typecheck, tests, and build. Stop at the ADR review gate and report recommendations, unresolved product decisions, commands, and results.
```

---

## Stage 2 — Document Integrity, Import/Export, and Recovery

### Objective

Protect the authored root document from malformed input, stale derived data, refreshes, crashes, and custom-view export truncation.

### Scope

- Introduce a versioned `GraphDocument`.
- Replace the optional-field node bag with discriminated authored-node types.
- Keep compute results and view caches outside the persisted document.
- Add a serializer that explicitly whitelists authored fields.
- Add deterministic migration from the current unversioned JSON format.
- Validate imports before mutation:
  - file size;
  - schema version;
  - node and edge counts;
  - nesting depth;
  - formula length;
  - finite numeric values;
  - unique IDs;
  - supported kinds;
  - valid endpoints and ports;
  - valid custom bindings.
- Make import replacement atomic and undo-safe.
- Preserve the active graph on all parse or validation failures.
- Default Export to the complete root project in every view.
- Make internal-graph export a separately labeled command if retained.
- Add versioned autosave, last-good recovery, dirty/saved status, and interrupted-write recovery.

### Acceptance Gate

- Invalid or adversarial imports never crash or partially replace the current document.
- Import errors identify the exact path and reason.
- Export contains no computed, timeseries, connection-cache, or presentation-only fields.
- Exporting from main and custom views produces the same root document.
- Reload restores every supported authored mutation.
- Last-good recovery survives malformed or interrupted saved state.

### Rollback

Retain the legacy unversioned reader and last-good recovery record until the versioned format is proven. Do not overwrite legacy recovery data during migration.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 2: document integrity, import/export safety, and recovery. Require the approved Stage 1 ADR and tests; if they are missing, stop and report that gate. Do not commit or push.

Introduce a versioned GraphDocument and discriminated authored-node schema. Keep compute results and view caches outside persisted data. Add deterministic migration from the current unversioned JSON and an explicit serializer whitelist.

Validate imports completely before mutation: file size, structure, finite numbers, unique IDs, endpoints, kinds, ports, formulas, nesting depth, node/edge counts, and custom bindings. Make replacement atomic and display actionable errors while retaining the existing graph. Ensure default export always returns the complete root document even inside a custom node. Add versioned autosave, last-good recovery, dirty/saved status, and reload/crash recovery without persisting partial state.

Add adversarial fixtures and root/custom round-trip tests. Run typecheck, tests, and build; report exact evidence and stop.
```

---

## Stage 3 — Formula and Computation Correctness

### Objective

Ensure invalid inputs fail visibly and valid graph components compute deterministically.

### Scope

- Replace the match-only tokenizer with a full-consumption lexer/parser.
- Implement the approved formula grammar without `eval` or `Function`.
- Correct:
  - leading decimals;
  - unary operators after commas;
  - precedence;
  - parentheses;
  - supported functions;
  - malformed commas;
  - unknown characters;
  - division by zero;
  - overflow;
  - `NaN` and infinities.
- Introduce structured compute results.
- Propagate failed dependencies instead of converting them to zero.
- Validate duplicate IDs and dangling edges.
- Detect actual strongly connected components.
- Distinguish:
  - cycle members;
  - dependents blocked by a cycle;
  - unrelated components that can still compute.
- Preserve the approved house-fund happy path.

### Acceptance Gate

- All confirmed parser defects have passing regression coverage.
- All numerical results are finite or accompanied by a structured error.
- Downstream nodes cannot silently succeed using a failed dependency.
- Only actual cycle members are labeled cyclic.
- Unrelated components continue computing.
- Error output includes node, graph path, and original cause.

### Rollback

Keep parser and engine changes isolated behind tested interfaces so they can be reverted without discarding the Stage 1 fixtures.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 3: formula and computation correctness. Require passing Stages 1-2. Preserve unrelated changes; do not commit or push.

Replace the match-only tokenizer with a full-consumption lexer/parser implementing the approved grammar. Correctly handle leading decimals, unary operators after commas, precedence, parentheses, supported functions, malformed commas, unknown characters, division by zero, overflow, NaN, and Infinity. Do not use eval or Function.

Introduce structured compute results that propagate failed dependencies instead of converting them to zero. Validate dangling edges and duplicate IDs. Detect actual strongly connected components, label only true cycle members, distinguish blocked dependents, and continue computing unaffected components. Preserve the approved house-fund happy path.

Add table-driven and property-oriented tests for every parser and graph error path. Run typecheck, tests, build, and focused defect probes; report results and stop.
```

---

## Stage 4 — Typed Simulation and Time Semantics

### Objective

Make every connection and financial projection dimensionally explicit.

### Scope

- Implement approved value/port types such as:
  - scalar;
  - monthly flow;
  - timeseries.
- Validate compatibility in both the engine and editor.
- Move simulation horizon and timing rules into versioned settings.
- Define:
  - expense behavior;
  - initial asset balances;
  - contribution timing;
  - negative flows and rates;
  - target boundary behavior;
  - unreachable-output behavior.
- Implement or remove `weight` and `lagMonths` according to the ADR.
- Provide independently addressable identities for custom output ports.
- Add migration defaults for existing documents.

### Acceptance Gate

- Incompatible connections are prevented or diagnosed.
- Configurable horizon tests cover month zero, final month, and month-after-horizon behavior.
- Chained assets cannot silently reinterpret an ending balance as a monthly contribution.
- Weighted and lagged edges either work as documented or are absent from the public schema.
- Two outputs from one custom node can be referenced independently.
- Existing documents migrate deterministically.

### Rollback

Retain a versioned migration capable of reading the legacy format and preserve the pre-migration fixture corpus.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 4: typed simulation and time semantics. Require the approved Stage 1 ADR and passing Stage 3 tests. Do not commit or push.

Implement explicit value/port types such as scalar, monthly flow, and timeseries, and validate connection compatibility in both the engine and editor. Move the 120-month constant and timing rules into versioned simulation settings. Implement or remove weight and lagMonths exactly as decided by the ADR; do not leave inert public fields. Give custom output ports independently addressable formula identities.

Cover expense behavior, contribution timing, initial balances, negative rates/flows, month-zero and boundary-month targets, configurable horizons, weighted/lagged flows, chained assets, and multi-output custom nodes. Add migration defaults that preserve the existing demo result where the ADR requires it.

Run typecheck, tests, build, and semantic fixtures. Report any intentional compatibility change and stop.
```

---

## Stage 5 — Nested Custom Graph Scope and Diagnostics

### Objective

Make nested custom graphs fully navigable, editable, serializable, and diagnosable.

### Scope

- Replace the single custom-node view state with an immutable graph-path identity.
- Add a view stack and breadcrumbs.
- Key selection and hierarchy expansion by scoped identity.
- Support repeated local node IDs in different scopes.
- Support opening, editing, leaving, exporting, importing, and computing at least two nested levels.
- Separate validation from repair.
- Do not silently create nodes or rewrite bindings when malformed data is opened.
- Make repair an explicit migration or user action.
- Filter binding choices by compatible value/port types.
- Include graph path, node, edge, and port in nested diagnostics.

### Acceptance Gate

- A two-level nested fixture with repeated local IDs computes correctly.
- Selection and focus resolve to the correct scope.
- Back navigation preserves changes and selection.
- Root export, import, autosave, and recovery retain the nested structure.
- Invalid bindings remain unchanged until an explicit repair is accepted.
- Nested errors identify the exact graph path and cause.

### Rollback

Retain the proven one-level navigation path until the scoped replacement passes its full round-trip fixture.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 5: nested custom-graph scope and diagnostics. Require passing Stages 2-4. Preserve unrelated changes; do not commit or push.

Replace the single customNodeId view model with an immutable graph-path/scope identity and a view stack with breadcrumbs. Key selection and hierarchy expansion by scoped identity so repeated local IDs are safe. Support opening, editing, backing out of, exporting, importing, and computing at least two nested custom levels.

Separate validation from repair: malformed bindings must not silently create nodes or change semantics. Make any repair an explicit migration/action. Filter binding choices by compatible types and surface structured diagnostics containing graph path, node, edge, and port.

Add a two-level nested fixture with repeated IDs and prove edit, compute, recovery, export, and reimport round trips. Run all checks, report evidence, and stop.
```

---

## Stage 6 — Authoritative State, Undo/Redo, Lifecycle, and Performance

### Objective

Create a maintainable editing architecture with recoverable commands and explicit resource ownership.

### Scope

- Introduce one authoritative versioned document store.
- Make Cytoscape a projection rather than the persistence authority.
- Route mutations through explicit commands:
  - node creation, edit, move, type change, and deletion;
  - edge creation, edit, and deletion;
  - port creation, edit, and deletion;
  - imports;
  - nested graph edits;
  - relevant document settings.
- Add undo/redo and selection restoration.
- Add controller `destroy()` cleanup for:
  - document and container listeners;
  - dynamic menus;
  - mutation observers;
  - pending animation frames and timeouts;
  - Cytoscape.
- Remove duplicate recomputation.
- Replace repeated `queue.shift()` processing with an index-based queue.
- Batch expensive updates.
- Split oversized modules only along tested store, engine, and adapter seams.
- Establish a representative large-graph benchmark.

### Acceptance Gate

- Undo/redo covers destructive operations, imports, ports, and nested graphs.
- Selection and focus restore after undo and redo.
- Mount/unmount/remount leaves exactly one controller and listener set.
- No callback fires after unmount.
- The agreed interaction and compute benchmark passes.
- Existing semantic fixtures remain unchanged.

### Rollback

Keep the Cytoscape projection adapter and store activation separable so the new authority can be reverted without invalidating the document schema.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 6: authoritative state, undo/redo, lifecycle, and performance. Require passing Stages 2-5. Do not commit or push.

Introduce one authoritative versioned document store and make Cytoscape a projection rather than the persistence authority. Route node, edge, port, type, import, nested-graph, and layout mutations through explicit commands with undo/redo and selection restoration.

Add controller destroy/cleanup that removes document/container listeners, menus, observers, pending animation/timeouts, and calls cy.destroy(); wire it into React effect cleanup. Remove duplicate recomputation, use an index-based queue, and batch expensive updates. Split oversized modules only along tested store/engine/adapter seams.

Add undo/redo integration tests, mount/unmount/remount leak tests, and a defined large-graph interaction benchmark. Run all checks and report before/after measurements, rollback seam, and results.
```

---

## Stage 7 — Accessible, Discoverable, and Responsive Authoring

### Objective

Make the complete authoring flow usable across keyboard, pointer, assistive technology, themes, and supported viewport widths.

### Scope

- Add visible Add, Connect, Open, Save, Undo, and Redo actions.
- Add concise empty-canvas onboarding.
- Provide a complete keyboard authoring path.
- Provide a semantic graph/tree representation exposing:
  - nodes;
  - edges;
  - ports;
  - values;
  - errors.
- Give dynamic menus appropriate roles, focus entry, Escape handling, and focus restoration.
- Surface compute and validation errors in the Inspector and a graph-level summary.
- Associate field errors using `aria-invalid` and `aria-describedby`.
- Add a restrained live region for asynchronous status.
- Introduce a compact stack, tabs, or drawer layout instead of compressing the 12-column desktop grid.
- Fix:
  - node and state contrast;
  - focus-visible styling;
  - reduced-motion behavior;
  - forced-colors behavior;
  - corrupted UTF-8 warning/arrow glyphs;
  - unsupported Cytoscape shadow styles;
  - numeric draft editing;
  - destructive-action messaging.

### Acceptance Gate

- Complete keyboard-only authoring flow passes.
- Screen-reader representation exposes nodes, connections, values, selection, and errors.
- Automated accessibility checks pass with documented manual verification.
- Node-kind/state/theme/scale contrast meets WCAG AA.
- Rendered width matrix passes at:
  - 1440 px;
  - 1280 px;
  - 1024 px;
  - 820 px;
  - 640 px;
  - 390 px.
- No clipped controls, overlapping panels, or inaccessible menu items.
- Browser console is free of project-owned warnings and errors.
- Screenshots and logs are retained as evidence.

### Rollback

Retain the prior workspace preset and theme tokens until the replacement layout and palette pass every viewport and accessibility gate.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 7: accessible, discoverable, responsive authoring UX. Require the Stage 6 command/store seam. Preserve unrelated changes; do not commit or push.

Add visible Add, Connect, Open, Save, Undo, and Redo affordances plus concise onboarding. Provide a complete keyboard path and a semantic graph/tree representation exposing nodes, edges, values, and errors. Make dynamic menus accessible with roles, initial focus, Escape, and focus restoration. Expose field and compute errors through the Inspector and restrained live regions.

Create a responsive stack/tab/drawer mode instead of compressing the 12-column grid. Verify 1440, 1280, 1024, 820, 640, and 390 px. Fix node contrast, focus-visible, reduced motion, forced colors, corrupted UTF-8 glyphs, unsupported Cytoscape shadow styles, numeric draft editing, and destructive-action messaging.

Retain screenshots, keyboard E2E evidence, accessibility results, contrast checks, and console logs. Do not claim a width or accessibility gate without rendered proof.
```

---

## Stage 8 — CI, Security, Documentation, Deployment, and Release Proof

### Objective

Make release readiness reproducible, evidence-based, and reversible.

### Scope

- Add CI gates for:
  - pinned clean install;
  - typecheck;
  - lint;
  - tests;
  - coverage;
  - production build;
  - bundle budget;
  - deployed-path smoke test.
- Perform current dependency advisory, outdated-package, and license checks only in an explicitly authorized environment.
- Align duplicate dependency majors.
- Configure automated dependency updates.
- Choose and consistently apply the canonical NodeSim/EconGraph product name.
- Document:
  - setup;
  - authoring workflows;
  - keyboard interaction;
  - formula grammar;
  - document schema and migration;
  - simulation semantics;
  - autosave and recovery;
  - accessibility;
  - deployment target and base path;
  - security headers;
  - artifact retention;
  - versioning;
  - rollback.
- Review unpublished/local commits without automatically pushing them.
- Produce a versioned release artifact and evidence-bound GO/NO-GO report.

### Acceptance Gate

- CI passes from a clean environment.
- No unresolved high/critical live advisory exists without a documented exception.
- The artifact loads from the exact intended production path.
- All assets return successful responses under the configured base path.
- Security headers match the deployment contract.
- A prior retained artifact can be restored successfully.
- Release documentation reproduces clone-to-build and rollback procedures.
- Production GO is granted only after all preceding technical and manual gates pass.

### Rollback

Redeploy the immediately preceding versioned artifact and retain the failed artifact and logs for diagnosis.

### Codex Kickoff Prompt

```text
Work in F:\AnnexedGames\NodeSim. Implement only Roadmap Stage 8: CI, security, documentation, deployment, and release proof. Require all prior automated gates. Do not commit, push, publish, or deploy without explicit authorization.

Add CI for pinned clean install, typecheck, lint, tests, coverage, production build, bundle budget, and deployed-path smoke testing. In an explicitly authorized environment, run current npm advisory, outdated-package, and license checks; do not transmit dependency metadata otherwise. Align duplicate dependency majors and configure automated dependency updates.

Choose and consistently apply the NodeSim/EconGraph product name. Document setup, authoring gestures, formula grammar, document schema/migration, simulation semantics, recovery, accessibility, deployment base path, security headers, artifact retention, versioning, and rollback. Review unpublished local commits without automatically pushing them.

Produce a versioned release artifact and evidence-bound GO/NO-GO report. Prove the exact target path loads and that the previous retained artifact can be restored. Stop after reporting results.
```

---

## Overall Completion Criteria

The roadmap is complete only when all of the following are true:

- Invalid formulas cannot silently produce values.
- Every persisted or exported numeric value is finite and authored intentionally.
- User-authored work survives refreshes, crashes, malformed saved state, and failed imports.
- Import and migration are validated and atomic.
- Root export is complete from every graph scope.
- Graph failures propagate clearly without invalidating unrelated components.
- Value, port, edge, asset, and time semantics are explicit and tested.
- Nested custom graphs are fully navigable and round-trip safely.
- Every destructive action is undoable or explicitly confirmed.
- Mounting and unmounting leave no leaked controllers, listeners, observers, or callbacks.
- Complete authoring is possible with keyboard and assistive technology.
- Every supported viewport has retained rendered evidence.
- Clean install, typecheck, lint, tests, coverage, build, and deployment smoke tests pass in CI.
- Current dependency and license checks have been performed in an authorized environment.
- Release artifacts are versioned, retained, deployable, and rollback-tested.
- The final release decision is evidence-bound rather than inferred from source or automation alone.
