# ADR 0002: Proposed deterministic money precision

- **Status:** Proposed; awaits the product owner's explicit choice
- **Date:** 2026-10-02
- **Scope:** R5's representation, rounding, and document compatibility contract
- **Authority:** [ADR 0001](0001-product-semantics.md) still governs current behavior

R5 requires a concrete precision decision before engine implementation. The
approved requirement calls for deterministic decimal/fixed-point money, but does
not specify scales or rounding. This proposal selects no external dependency and
does not change the running prototype or approve financial-decision use.

## Proposed contract

Use signed BigInt fixed-point values internally. Scalars, dimensionless rates,
weights, and formula intermediates use 12 fractional decimal places. Money has
two fractional places. Round to the nearest representable value with ties to the
even integer, symmetrically for negative values. Never use binary floating-point
operations or display rounding to decide a result or threshold.

- Parse decimal literals directly from their text. Round literals and authored
  rates/scalars once to 12 places. Addition/subtraction are exact at that scale;
  multiplication and division round their result once to 12 places. Division by
  a zero represented divisor remains a structured error.
- Enforce the existing non-negative expense, initial-balance, and target rules
  on the parsed input before precision rounding. A tiny negative authored expense
  cannot become valid merely because it would round to zero. Signed income,
  arithmetic results, and asset ending balances retain their approved roles.
- Normalize income/expense with exact ratios: day 30, week 52/12, month 1, year
  1/12. Round each resulting monthly-flow sample to cents at the node boundary.
- Transform an edge by weight first. Monthly-flow and balance-series samples
  round to cents after weighting, then lag by whole months. Scalar transforms
  retain 12 places. Aggregate incoming rounded samples exactly; round a completed
  arithmetic/formula monthly-flow result once to cents. Formula intermediates
  retain 12 places; they are not individually rounded to cents.
- Keep existing dimensional compatibility. Scalar × flow and flow ÷ scalar
  produce cents; scalar/scalar produces a 12-place scalar. A scalar can also mean
  a point-in-time amount, so it becomes cents only at an explicit money boundary.
- Apply the 12-place arithmetic rounding before any completed money boundary's
  cent rounding, including normalization, edge transforms, binary nodes, formula
  results, and monthly asset updates. Normalize with the exact time ratio before
  rounding the result; do not round the ratio `52/12` separately. Nominal authored
  daily/weekly/yearly amounts retain up to 12 places before normalization, so a
  daily `0.001` amount can produce a monthly `0.03` flow. Rounding zero discards
  its sign. This is a finite-precision contract, not arbitrary-precision rational
  arithmetic: `0.03 * 0.499999999999` becomes `0.015` at 12 places, then `0.02`
  at its money boundary. This boundary effect is an explicit approval point.
- Round initial balance and target amount to cents once. APR is a 12-place
  scalar; divide by 12 at that precision. Each month computes opening balance ×
  (1 + monthly rate) at 12 places, adds the cent contribution, then rounds the
  ending balance to cents. The next month starts with that rounded balance.
  Threshold comparisons sum cent balances and compare integer cents exactly.
- Require a documented magnitude bound in the implementation: proposed maximum
  absolute scalar/money amount is 10^12 units. Reject out-of-range authored values
  or intermediates with structured diagnostics, preserving unrelated components.
  Counts, horizon, and month indices remain integers under their existing limits.
- Convert exact results to canonical decimal strings for display/export of
  diagnostics. Any numeric rendering adapter is presentation only and cannot feed
  a later calculation. Derived values remain outside the authored store.

## Document compatibility

Use a version 2 authored document for this contract, with an explicit precision
identifier `fixed12-money2-half-even-v1` and canonical decimal strings for decimal
fields. Counts/coordinates and horizon remain ordinary numeric fields. Preserve
the existing `Econ*` runtime type names while updating their engine value seam.

Continue reading version 1 and legacy documents in their current IEEE-754 mode;
never silently change their calculation contract on Open, reload, or autosave.
Provide an explicit, undoable **Upgrade precision** candidate preview after full
validation. Convert each v1 number from its canonical JavaScript decimal string,
then apply the proposed scale. Already lost input digits cannot be reconstructed.
Preview shows affected authored values and changed target-month/asset results;
the user accepts the complete v2 root document before it becomes authoritative.
Save retains the selected document version. Existing v1 exports remain readable.

The [source-grounded migration analysis](../MONEY_PRECISION_MIGRATION.md) identifies
another required boundary: old v1-only readers can recover an older v1 last-good
record when a new-schema current record is unknown, then save back into the v1
slots. The proposal therefore keeps future v2 envelopes in distinct `nodesim.*`
storage slots and retains v1/`econgraph.*` records unchanged. New readers must
make cross-version selection/conflicts explicit rather than compare independent
namespace revisions or silently re-upgrade an imported v1 document. This is a
proposed compatibility rule; no new storage namespace or migration is implemented.

## Exact acceptance references

| Case | Required exact result under the proposal |
| --- | --- |
| Scalar `0.1 + 0.2` | `0.3` |
| Scalar `1 / 3` | `0.333333333333` |
| Scalar `(1 / 3) * 3` | `0.999999999999` |
| Cent rounding of `1.005`, `1.015` | `1.00`, `1.02` |
| Cent rounding of `-1.005`, `-1.015` | `-1.00`, `-1.02` |
| Weekly income `0.01`, monthly normalization | `0.04` |
| Daily income `0.001`, monthly normalization | `0.03` |
| Flow `0.03` weighted by scalar `0.499999999999` | `0.02` after the explicit 12-place then cent boundaries |
| Initial `1000`, APR `0.12`, monthly contribution `1` | End months 1–3: `1011.00`, `1022.11`, `1033.33` |
| Same asset, target `1022.11` / `1022.12` | Month `2` / month `3` |
| Lagged first cent flow sample | Exact zero for each preceding month |
| Invalid/out-of-range/division-by-zero input | Structured error; dependents blocked |

Before completion, compare 1,200-month and positive/negative boundary fixtures
against an independent exact-integer reference, check two-level custom bindings,
and test every version/migration/history/import/export path. Record the product
owner’s precision decision and subsequent acceptance separately from test passes.

## Decision pending

Approve this contract or provide different money/scalar scales, rounding points,
magnitude bounds, or migration behavior. Implementation waits for that choice.
