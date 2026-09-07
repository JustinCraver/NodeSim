# Working on NodeSim

NodeSim is a React/TypeScript browser prototype for typed financial simulation
graphs. It has no backend or accounts. Documents live in browser localStorage
and exported JSON. IEEE-754 money remains prototype-only; the approved decimal /
fixed-point requirement is still open.

## Read first

- Inspect `git status --short` and preserve unrelated work.
- [Approved semantics](docs/adr/0001-product-semantics.md) define intended behavior.
- [Product guide](docs/PRODUCT_GUIDE.md) describes current workflows and architecture.
- [Project review](docs/PROJECT_REVIEW.md) records verified gaps and proposed next work.
- [Roadmap](docs/AUDIT_REMEDIATION_ROADMAP.md) retains stage scope and acceptance gates;
  its original audit is historical. Recommendations are not approved commitments.
- [Release runbook](docs/RELEASE_OPERATIONS.md) governs artifacts and deployment.
  `artifacts/stage-7/` and `artifacts/stage-8/` are dated evidence, not current acceptance.

Follow the requested stage/scope. Tests do not grant product, manual accessibility,
hosted-CI, or deployment acceptance. Do not commit, push, publish, or deploy without
explicit authorization.

## Code map and boundaries

- `src/App.tsx`: store/controller wiring, import/export, autosave, scope navigation,
  selection, workspace panels, and responsive mode (1100 px breakpoint).
- `src/document/graphDocument.ts`: v1 authored schema validation and legacy migration.
  `documentStore.ts`: explicit commands and 100-entry undo/redo history.
  `documentStorage.ts`: current/temporary/last-good envelopes and legacy-key reader.
- `src/engine/`: strict formula grammar, typed monthly simulation, connection validation.
- `src/graph/createCytoscape.ts`: mutable rendering/input adapter; emit commands here.
  `graphScope.ts`: immutable paths/scoped identity; `customBindings.ts`: diagnosis and
  explicit repair; `controllerLifecycle.ts`: owned-resource cleanup.
- `src/ui/`: toolbar, semantic hierarchy, Inspector, numeric drafts, and panels.
- `tests/`: core regressions, nested/semantic fixtures, benchmarks, and CLI smoke tests.
  `scripts/`: local verification and packaging. There is no checked-in browser E2E runner.

The document store is the authored-state authority; never save Cytoscape data or
computed caches directly. Preserve `econgraph.*` reads and the existing `Econ*`
runtime type names. Export the root document from every scope. Validate a complete
candidate before committing it. Do not bypass binding validation to make custom
port controls work; see the review. Keep diagnostics scoped when local IDs repeat.

## Commands (PowerShell, repository root)

Use Node `24.18.0`, npm `11.16.0`; retain the lockfile. Use `npm.cmd` to avoid the
PowerShell npm-script policy issue; other shells use `npm`.

| Task | Command |
| --- | --- |
| Install | `npm.cmd ci --no-audit` |
| Run locally | `npm.cmd run dev` → printed URL, normally `http://127.0.0.1:5173/NodeSim/` |
| Developer checks | `npm.cmd run check` |
| Focused tests | `npm.cmd test -- tests/documentStore.test.ts` (substitute the affected file) |
| Semantic fixtures | `npm.cmd run fixtures:semantic` |
| Benchmarks | `npm.cmd run benchmark:large-graph` |
| Full local checks | `npm.cmd run ci:verify` |
| Build / inspect build | `npm.cmd run build` then `npm.cmd run preview` |
| Local artifact smoke | `npm.cmd run smoke:deployed` (requires `dist/`) |

`typecheck`, `lint`, `test`, `coverage`, `deps:duplicates`, and `bundle:check` are
also independent scripts. Coverage is core transformed-byte/function coverage,
not UI coverage. `dev:lan` deliberately exposes the server to the LAN. The normal
base is `/NodeSim/`; a `NODESIM_BASE_PATH` override is not production-path proof.

If Git reports dubious ownership in this Windows sandbox, use command-local
`git -c safe.directory=F:/AnnexedGames/NodeSim ...`; do not edit global Git settings.
Cache/output EPERM failures can be account-specific. Use the permitted execution
context; do not change application code or machine permissions to hide them.

## Verification and documentation

Run focused regressions for behavioral fixes and the relevant aggregate check.
For UI changes, inspect the rendered app and affected desktop/compact workflows
on an isolated local origin so existing browser documents stay untouched. The
current tests do not mount React or the real Cytoscape controller.

Update the product guide for workflow/schema behavior, the release runbook for
commands/artifacts, and the review when resolving a recorded gap. Change approved
semantics only through an explicit product decision. Preserve dated evidence.

Registry advisory/outdated checks need an authorized environment. The license
script is offline but has recorded failures. Local smoke injects headers itself
and cannot verify a real origin. Do not rerun `release:package` against an existing
artifact: the current packager overwrites its output; follow the runbook's fresh
output procedure until the reviewed packaging fix is implemented.
