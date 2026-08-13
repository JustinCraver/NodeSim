# ADR 0001: Product Semantics and Document Guarantees

- **Status:** Proposed — Stage 1 review gate
- **Date:** 2026-08-12
- **Decision owners:** Product and engineering
- **Scope:** Semantic contract only; no schema, parser, engine, persistence, or UI remediation is authorized by this ADR

## Context

NodeSim currently has an unversioned `GraphData` document, permissive optional
fields, scalar edge transport, a fixed 120-month asset simulation, and a small
formula evaluator. Characterization tests protect valid behavior that exists
today. They also expose legacy behavior that must remain readable during a
future migration but is not necessarily approved as the final product contract.

The audit confirmed materially incorrect formula results, non-finite values,
ignored edge metadata, over-broad cycle errors, and missing persistence and
root-document export guarantees. Those defects are pending test targets, not
accepted behavior.

Normative terms such as **MUST**, **MUST NOT**, and **SHOULD** below describe the
recommended target contract. Because this ADR is still Proposed, every item in
the review table requires approval before Stage 2 starts.

## Proposed decision

### 1. Formula grammar

Formula parsing MUST consume the entire input. Any character or token not
described by this grammar is an error; silently skipping text is forbidden.

```ebnf
expression     = additive ;
additive       = multiplicative, { ("+" | "-"), multiplicative } ;
multiplicative = prefix, { ("*" | "/"), prefix } ;
prefix         = [ "-" ], primary ;
primary        = number
               | reference
               | function-call
               | "(", expression, ")" ;
function-call  = ("sum" | "min" | "max"), "(", expression,
                 { ",", expression }, ")" ;
reference      = identifier, [ ".", identifier ] ;
identifier     = (letter | "_"), { letter | digit | "_" } ;
number         = digits, [ ".", digits ] | ".", digits ;
```

- Whitespace MAY appear between tokens.
- Decimal literals such as `12`, `12.5`, and `.5` are valid.
- Scientific notation, implicit multiplication, assignment, property access
  beyond one output segment, strings, and arbitrary JavaScript are invalid.
- Unary minus is valid anywhere a prefix expression is valid, including
  `max(1, -2)`. Unary plus is not part of the initial grammar.
- `sum`, `min`, and `max` require at least one argument.
- Identifiers refer only to visible inputs in the current graph scope. Labels
  are presentation and MUST NOT act as identifiers.
- Operator precedence is unary minus, multiplication/division, then
  addition/subtraction. Binary operators are left-associative.

### 2. Finite-number policy

All authored numeric fields, normalized values, formula intermediates, edge
transforms, simulation samples, and outputs MUST be finite numbers.

- `NaN`, positive infinity, and negative infinity are invalid.
- Division by zero is a structured calculation error.
- Overflow to a non-finite value is a structured calculation error.
- A failed node has no numeric result and carries a diagnostic. Downstream
  nodes MUST be marked blocked; they MUST NOT silently substitute zero.
- Serialization MUST reject non-finite values and MUST NOT rely on JSON's
  conversion of them to `null`.
- Equality and threshold comparisons use the stored numeric value. A separate
  product decision is still required for decimal/currency precision.

### 3. Expense sign convention

An expense is a non-negative monthly-flow magnitude. Normalization does not
negate it. Subtraction is explicit in a subtract node or formula.

- Negative authored expenses are invalid.
- Refunds or reimbursements are modeled as income unless a future signed-flow
  type is explicitly approved.
- Edge weights are non-negative under the proposed policy, so sign changes
  remain visible in graph operations rather than hidden in connections.

This preserves the house-fund model's `4000 - 2500 = 1500` behavior and avoids
double-negating expenses.

### 4. Value types and operator compatibility

The semantic model has three computational value types plus a no-value state:

| Type | Meaning | Initial producers |
| --- | --- | --- |
| `scalar` | A dimensionless number, count, ratio, month index, or point-in-time amount | value, arithmetic, formula, asset ending balance, output |
| `monthly-flow` | An amount normalized to one month | income, expense, compatible arithmetic/formulas, custom ports |
| `timeseries` | Ordered end-of-month samples for the document horizon | asset balance |
| `none` | Presentation-only; cannot connect to computational inputs | text |

Rules:

- Add and subtract require matching input types and retain that type.
- Multiply allows scalar × scalar or scalar × monthly-flow.
- Divide allows scalar ÷ scalar or monthly-flow ÷ scalar.
- Other arithmetic combinations are type errors until explicitly defined.
- Formula and custom output ports MUST declare their output type in the future
  versioned schema. Legacy formula results migrate as `scalar` unless a safe,
  deterministic inference proves `monthly-flow`.
- Timeseries arithmetic is not implicit. It requires a future explicitly typed
  node or function.
- Text nodes produce `none`.

The current TypeScript optional-field bag does not enforce these rules; schema
and engine changes belong to later stages.

### 5. Edge weight and lag

Every computational edge has these target semantics:

- `weight` defaults to `1`, MUST be finite and non-negative, and multiplies the
  source value before target-port aggregation.
- `lagMonths` defaults to `0` and MUST be a non-negative integer.
- Weight is applied before lag.
- A lag shifts monthly-flow or timeseries values later by that many months and
  fills preceding months with zero.
- A non-zero lag on a scalar edge is invalid because a point-in-time scalar has
  no simulation position.
- Port validation occurs before either transform.
- Unsupported or invalid metadata is an error; it MUST NOT be ignored.

The existing engine silently ignores both fields. That behavior is a confirmed
defect and is not protected as an intended result.

### 6. Asset semantics

An asset consumes zero or more monthly flows and has the following contract:

- `initialBalance` is an authored finite, non-negative amount and defaults to
  `0` for migrated documents.
- `interestRateAnnual` is a nominal annual rate. The monthly rate is
  `interestRateAnnual / 12`.
- Contributions are summed for each month.
- Each monthly sample is calculated as:

  ```text
  endingBalance = openingBalance * (1 + monthlyRate) + contribution
  ```

  Therefore interest is applied first and the contribution occurs at the end
  of the month.
- Month zero is the initial balance and is not included in the emitted series.
- The emitted balance series has exactly `simulationHorizonMonths` samples,
  indexed internally from zero and presented to users as months 1 through N.
- The document owns `simulationHorizonMonths`; the proposed default is `120`.
- Asset outputs are explicitly named:
  - `balance`: `timeseries`;
  - `endingBalance`: `scalar`.
- New documents MUST identify the source output. Migration maps an unported
  legacy asset-to-output edge to `balance` and other legacy asset edges to
  `endingBalance`.

### 7. Output and unreachable semantics

The initial output node is a threshold-month query:

- It accepts one or more compatible asset balance timeseries.
- Multiple series are summed sample-by-sample.
- `targetAmount` MUST be finite and non-negative.
- The result is the first one-based month whose combined value is greater than
  or equal to the target.
- If no sample reaches the target, the result is the explicit tagged state
  `unreachable`, not numeric `-1`.
- A missing or blocked source is a diagnostic, not `unreachable`.

The UI may continue to render the word “Unreachable.” A migration adapter may
read legacy `-1`, but new persisted or API output MUST use the tagged state.

### 8. Multi-output formula identifiers and ports

Node IDs and port IDs are stable authored identities. Display labels are not.

- A single-output source is referenced by `nodeId`.
- A named output is referenced by `nodeId.outputId`.
- Each identifier segment follows the formula identifier grammar.
- A multi-output node has no implicit default in new documents; an edge and a
  formula reference MUST select an output.
- Legacy custom edges with no `sourcePort` migrate to the first declared output
  to preserve current behavior, then serialize explicitly.
- Two edges from distinct outputs of the same node remain distinct formula
  inputs. They MUST NOT be merged under only the source node ID.
- Formula inputs are limited to connected, type-compatible values. Global or
  label-based lookup is forbidden.

Existing hyphenated port IDs remain document identities during migration but
need deterministic formula-safe output identifiers before they can appear in
formula references.

### 9. Nested scope identity

- The root graph has canonical scope identity `/root`.
- Node IDs are unique within a scope, not globally.
- A custom-node instance creates a child scope addressed by appending its
  stable node ID, for example `/root/savingsAdjuster`.
- A nested node's canonical identity is its scope path plus its local node ID,
  for example `/root/savingsAdjuster/customInput`.
- Separate custom instances may reuse the same internal local IDs without
  collision.
- Formulas resolve only within their local scope. Cross-scope data moves only
  through declared custom ports and bindings.
- Renaming a label, moving a node, or changing a panel MUST NOT change identity.
- Duplicate IDs, orphaned endpoints, invalid bindings, and recursive scope
  ambiguity are document-validation errors.
- A maximum nesting depth must be chosen before nested editing ships.

### 10. Persistence, import/export, and recovery guarantees

The future authoritative artifact is a versioned root `GraphDocument` containing
only authored state and explicit document settings.

- Computed values, timeseries caches, transient input flags, selection, hover,
  and rendered overlays are derived/session state and MUST NOT be authoritative.
- Export always serializes the root document, even while the UI displays a
  nested custom scope.
- Import parses and validates a separate candidate completely before mutating
  the active document. Failure leaves the active document byte-for-byte
  unchanged.
- Every accepted authored edit schedules persistence of a complete valid root
  document. The last valid authored state must survive reload and crash.
- Writes are atomic: write a temporary candidate, flush it where supported,
  validate readback, then replace the current record.
- At least one last-known-good record is retained. Recovery never overwrites a
  newer valid record with an older one silently.
- Migrations are deterministic, versioned, idempotent, and preserve an
  untouched copy of imported legacy bytes until the migrated document is
  accepted.
- Derived state is recomputed after load and is never trusted from legacy JSON.
- Import/export ordering and formatting SHOULD be deterministic to support
  reviewable diffs, but semantic equality does not depend on object-key order.

Implementation of these guarantees is Stage 2 work and is deliberately absent
from this stage.

## Current behavior to preserve

The passing characterization suite protects these behaviors until an approved
migration says otherwise:

| Area | Preserved behavior |
| --- | --- |
| Time normalization | day × 30, week × 52/12, month × 1, year × 1/12 |
| Expenses | normalize as positive magnitudes |
| Values | disconnected base value; connected inputs sum and replace the base |
| Binary math | authored left/right defaults; explicit `1`/`2` and legacy `left`/`right` ports; repeated port inputs sum |
| Formula happy path | identifiers, parentheses, `+ - * /`, unary minus where currently valid, `sum`, `min`, and `max` |
| Asset baseline | zero initial balance, nominal annual rate divided by 12, end-of-month contribution, 120 samples |
| Output baseline | first one-based threshold month; current `-1` is legacy-only, not the target representation |
| Custom nodes | input bindings target internal income/value nodes; incoming values sum per port; explicit source ports select outputs |
| Text | no computational value |
| House-fund fixture | net income 4000, expenses 2500, savings 1500, adjusted savings 1350, target month 43 |
| Legacy JSON | current unversioned `GraphData` and nested custom fields remain readable during migration |

## Confirmed defects and pending target coverage

These are not intended behavior. Each has a non-running `todo` test so the target
remains visible without leaving the suite red.

| Confirmed current behavior | Target |
| --- | --- |
| `1$+2` evaluates as `3` because unknown text is skipped | Reject the unknown character and the whole expression |
| `.5 + .25` evaluates as `30` | Evaluate as `0.75` under the proposed grammar, or explicitly reject if the grammar decision changes |
| Formula `1 / 0` produces infinity and JSON can turn it into `null` | Emit a finite-number/division diagnostic |
| `max(1, -2)` reports invalid function usage | Evaluate to `1` |
| A cycle marks unrelated nodes cyclic | Diagnose only cycle members and blocked dependents |
| Edge `weight` and `lagMonths` are ignored | Apply approved semantics or reject invalid metadata |
| Authored edits disappear on reload | Recover the last valid root document |
| Export inside a custom view exports only the internal graph | Export the authoritative root document |
| Import replaces the active graph without full validation | Validate atomically before replacement |

## Product review decisions still open

| Decision | Recommendation in this ADR | Alternatives or impact |
| --- | --- | --- |
| Leading decimal literals | Accept `.5` | Rejecting them is simpler but less familiar; either choice must be explicit |
| Numeric precision | Adopt deterministic decimal/fixed-point money before financial-decision use | Binary floating point is simpler but needs documented tolerances and rounding |
| Expense sign | Non-negative magnitude with explicit subtraction | Signed expenses are compact but create double-negation risk |
| Edge weight sign | Non-negative only | Signed weights add flexibility but hide sign changes in connections |
| Lag on scalar values | Reject | Defining scalar timing requires a broader event/time model |
| Asset rate | Nominal APR divided by 12 | Effective annual rate changes every existing projection |
| Contribution timing | End of month after interest | Beginning-of-month contributions produce larger balances |
| Horizon | Document setting, default 120 months | Per-node horizons complicate timeseries combination |
| Initial asset balance | Finite and non-negative, default zero | Signed balances would mix asset and liability semantics |
| Unreachable output | Tagged `unreachable` | Keeping `-1` is easy but conflates data and status |
| Multi-output syntax | `nodeId.outputId` with formula-safe stable IDs | Bracket or port syntax can preserve arbitrary IDs but complicates grammar |
| Nested scope limit | Choose a bounded depth before Stage 5 | Unlimited recursion increases validation, UX, and recovery risk |
| Recovery retention | Current plus at least one last-known-good document | More generations improve recovery at storage/privacy cost |
| Autosave cadence | Debounced after every valid authored transaction | Manual save is simpler but does not meet crash-recovery goals |

## Consequences

### Positive

- Correctness targets are explicit before parser or engine changes.
- Current valid behavior has executable protection.
- Type, port, scope, and persistence boundaries no longer depend on UI labels or
  incidental JavaScript values.
- Later schema and migration work can cite one reviewable semantic authority.

### Costs and risks

- The proposed type system requires future schema and engine work.
- Legacy unversioned documents need deterministic migration.
- Decimal/fixed-point arithmetic may require a new implementation dependency or
  integer minor-unit policy.
- Explicit multi-output ports add authoring and migration complexity.

## Stage 1 review gate

Before Stage 2 begins, product and engineering must review and record approval or
changes for every row in **Product review decisions still open**. Approval of
this ADR authorizes semantic direction only; it does not authorize Stage 2
implementation. Until review is recorded, this ADR remains **Proposed**.
