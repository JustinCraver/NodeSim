# Proposed precision upgrade: source and compatibility analysis

Reviewed 2026-10-02 on `main` at `3edb13a`, including the review follow-up's
uncommitted local work. This supports [proposed ADR 0002](adr/0002-money-precision.md)
and R5; it implements no new schema, storage tier, or calculation contract.
ADR 0001 remains the approved semantic authority. Owner approval and subsequent
engine, migration, browser, and product acceptance are still required.

## Current seams that must change together

| Current authority | Verified current behavior | Required work after an approved precision choice |
| --- | --- | --- |
| [models/types.ts](../src/models/types.ts) | `GraphDocument` is schema 1; authored decimal fields and `RuntimeValue` payloads are JavaScript numbers. Existing `Econ*` types also carry numeric presentation data. | Separate v1/v2 authored unions and exact engine payloads. Keep existing runtime type names; ensure presentation numbers cannot become a later engine input. |
| [graphDocument.ts](../src/document/graphDocument.ts) | `migrateGraphDocument` rejects any defined schema version other than 1. `createGraphDocument` always emits v1; serialization revalidates through that reader. | Explicit schema dispatch, bounded canonical-decimal parsing, deterministic v2 serialization, and deliberate candidate upgrade. Keep legacy and v1 readers/calculations. Never coerce a v2 document through the v1 constructor. |
| [documentStore.ts](../src/document/documentStore.ts) | Every scoped edit currently goes authored root → permissive numeric runtime graph → `createGraphDocument`; horizon changes also reconstruct through that seam. | Preserve document version/precision across every command and history entry. Apply v2 commands to authored exact data; root/nested edits must not silently reconstruct v1 or narrow a decimal to Number. |
| [documentStorage.ts](../src/document/documentStorage.ts) / [autosaveSession.ts](../src/document/autosaveSession.ts) | Envelope version 1 wraps a validated JSON payload. Recovery selects independently validated tiers; valid last-good can replace an invalid/unknown current payload on a later accepted save. | Keep v2 payloads in separate future NodeSim storage slots, leaving v1 and `econgraph.*` data readable and untouched. Specify deterministic cross-version selection, revision namespaces, explicit Load saved version, locks/conflict handling, and interrupted upgrade recovery. |
| [formula.ts](../src/engine/formula.ts) | Decimal tokens are converted to Number before the AST/evaluator sees them; intermediates use Number arithmetic. Grammar/type inference is already strict. | Retain the original decimal lexeme for an exact v2 evaluator. Preserve v1 evaluation, grammar, positions, identifiers, type inference, diagnostics, and finite/overflow behavior. |
| [computeGraph.ts](../src/engine/computeGraph.ts) | Flow normalization, sums, weights, binary operations, monthly rates/balances, custom injection, and thresholds all use numeric payloads. | Make the chosen exact contract cover every seam, including custom port transport, series samples, scalar ending balances, mixed flow/scalar operations, and combined target series. No conversion through Number before comparisons. |
| [NumericDraftField.tsx](../src/ui/NumericDraftField.tsx) and its Inspector/toolbar callers | Draft text is validated with `Number(...)` before a command; R9's outcome/error/reset behavior is now explicit. | A v2 decimal draft must commit validated canonical text, preserving accepted digits. Retain the shared draft/error/history/selection behavior. Counts/horizon/coordinates/node scale remain their existing finite numeric fields. |
| [createCytoscape.ts](../src/graph/createCytoscape.ts) / [HierarchyPanel.tsx](../src/ui/HierarchyPanel.tsx) | Display and computed labels expect numeric runtime fields. The authored store remains authority. | Display exact decimal text from derived results; keep numeric renderer positions/scale separate. Root export must retain authored exact fields from every scope, with no derived value or BigInt leaking into JSON. |

## Storage downgrade hazard

Current source rejects an unknown schema 2 current payload. If a valid v1
last-good record also exists, `load()` selects that v1 document and leaves
`saveBlocked` false: its baseline is the records it just read. A later v1 save can
replace the unknown current bytes because they still match that baseline. This
is appropriate corruption recovery for the current v1-only contract, but would
make reusing those same slots unsafe for a future precision upgrade. Web Locks
serialize cooperating writes; they do not teach a frozen v1 reader a new schema.

The [current-source observation](../artifacts/review-2026-10-02/precision-v1-observation-2.json)
confirmed this sequence using a disposable in-memory Map: load preserved the
unknown current bytes, selected v1 last-good with `saveBlocked: false`, and a
subsequent save replaced the unknown bytes. No browser or disk document was
mutated; the receipt binds the exact inspected source-file hashes. This is a
future upgrade compatibility risk, not a claim that a valid v2 app exists today.

The proposal uses a separate future v2 namespace rather than editing current v1
recovery behavior or pretending old clients understand a new payload. The new
reader must consider both versions, preserve retained data, and surface conflicts
without comparing independent revision sequences. An explicit precision upgrade
must validate/preview the complete candidate and choose its new storage target
deliberately. Opening or importing a v1 document must remain v1 until an explicit
upgrade is accepted. Old clients may continue to edit their retained v1 snapshot;
the product must not claim automatic cross-version merging or shared acceptance.

The envelope's own version, payload schema, active document version, and source
namespace are separate identities. Specify them in recovery/history tests rather
than deriving the saved target solely from a string in a storage key. No v2
namespace is created by this analysis.

## Candidate preview and loss of original input text

V1 JSON numbers already passed through IEEE-754. The upgrade can preserve only
their current canonical JavaScript decimal value, not reconstruct the user's
earlier keystrokes. `String(number)` can use exponent notation; a migrator must
expand that spelling exactly before canonical decimal parsing, even though
formula literals still reject scientific notation. Do not run another Number
round trip over v2 text.

The proposed preview must identify each affected field by immutable scope/local
ID, show current and proposed authored values, show changed asset samples/target
months, and report any range/type/schema rejection before store replacement.
Rates/weights/nominal authored flows retain 12 places; normalized flow and balance
samples, initial balance, and targets use their explicit money boundaries. A
formerly valid finite v1 value above the proposed bound blocks only that upgrade
candidate; it does not invalidate or replace the still-open v1 document.

Counts, coordinates, node scale, port identity/type/bindings, formula text, labels,
edge lag, and scope paths retain their existing roles. Expense sign, asset timing,
nominal APR, horizon, type compatibility, blocked dependencies, and tagged
unreachable states remain governed by ADR 0001. Never synthesize a custom binding
or silently repair an import during a precision upgrade.

## Exact references prepared for review

The [independent design oracle](../artifacts/review-2026-10-02/precision-reference.py)
uses standard-library exact Fraction quotient/remainder rounding and a separate
100-digit Decimal implementation. It compares every sample, including two
1,200-month cases, cent ties/sign/zero, scalar division, normalization, and explicit
range/rounded-zero-divisor controls. Its output is a draft fixture receipt, not
the production engine and not an approved acceptance result.

[Derived references](../artifacts/review-2026-10-02/precision-reference-2.json) retain
all 2,418 samples for five asset cases, with agreement between the two independent
oracle paths and explicit negative controls. The current-source observer shows a
concrete threshold change: v1's `0.1` monthly contributions with zero APR reach
target `1` at month 11; the proposed contract reaches `1.00` at month 10. This
comparison is preparation for the required upgrade preview, not an accepted
change to current computation.

To reproduce without installs, use an already available Python 3 standard-library
runtime and the existing locked `vite-node` package, choosing fresh output files:

```powershell
& '<existing-python-executable>' artifacts/review-2026-10-02/precision-reference.py --output artifacts/precision-reference-fresh.json
# The observer reads the retained draft reference and verifies its ADR hash:
node node_modules/vite-node/vite-node.mjs --script artifacts/review-2026-10-02/precision-v1-observation.ts artifacts/precision-v1-observation-fresh.json artifacts/review-2026-10-02/precision-reference-2.json
```

The first command can verify deterministic output against the retained reference.
After any contract edit, regenerate the retained reference into a new receipt and
pass that new reference path to the observer; never replay stale hashes
or overwrite historical references. Neither helper is a production precision gate.

The proposal deliberately rounds arithmetic to 12 places before cent boundaries.
Both single-node binary operations and formula intermediates need the same rule;
near-cent examples must reveal the guard-digit boundary instead of obscuring it
with display formatting. Per-edge money rounding also makes graph topology
matter: two separately weighted/rounded flows need not equal a combined flow
weighted once. These are reviewable precision choices before implementation.

## Acceptance still required after the decision

- Validate all positive/negative boundary and long-horizon references against the
  real exact engine, not merely the design oracle; preserve strict independent
  reference assertions and invalid/overflow/division controls.
- Keep full-root candidate validation before any mutation. Test schema rejection,
  canonical round trips, exponent expansion of v1 numbers, exact v2 input text,
  and values that cannot be upgraded within the selected contract.
- Test every command, Undo/Redo, scoped repeated IDs, custom input/output transport,
  root export, explicit upgrade/Undo, and v1/v2/legacy file import behavior.
- Inject interruption/read/quota failures and competing old/new readers around
  upgrade saves. Retain original namespace bytes and honest last-good history;
  never treat an unsupported new schema as permission for an old writer to erase it.
- Verify real Inspector/horizon/edge workflows, reset/focus/error association,
  browser reload/recovery, and desktop/compact remount with exact authored values.
- Record the product owner's precision decision and subsequent product acceptance.
  Neither a proposed ADR nor green local tooling grants financial-decision use.
