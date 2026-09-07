# NodeSim product and authoring guide

## Product identity and setup

NodeSim is the canonical product name in the interface, package metadata,
exports, documentation, and release artifacts. Browsers with data under the
legacy `econgraph.*` local-storage keys remain readable; new writes use
`nodesim.*` keys for documents and workspace layout. Theme still uses `theme`.

Install the exact Node.js `24.18.0` and npm `11.16.0` toolchain, clone the
repository, and run:

```powershell
npm.cmd ci --no-audit
npm.cmd run ci:verify
npm.cmd run dev
```

The development server listens only on `127.0.0.1`. Use `dev:lan` only when
trusted-LAN access is intentional. Open the printed URL under `/NodeSim/`.
This is a browser-only application; there is no server-side document storage.

## Authoring workflows and gestures

Use the visible **Add**, **Connect**, **Open**, **Save**, **Undo**, and **Redo**
controls for basic authoring. Known incomplete paths are listed below.

1. Add a node and select it in the canvas or semantic **Graph structure** tree.
2. Edit authored fields in the Inspector. Numeric drafts commit only when valid.
3. Connect two nodes with **Connect**. It chooses the first compatible pair of
   ports. Select the resulting connection and edit **Source Port** / **Target
   Port** in the Inspector when a different pairing is needed. Multi-port
   selection before creation remains a recommended improvement.
4. Double-click or double-tap a custom node to open its internal graph. Use the
   breadcrumb or **Back one level** to return.
5. Drag nodes to position them. Drag panel headers and resize handles in the
   desktop workspace; at 1100 px and below, use the Graph, Graph structure, and
   Inspector tabs.
6. Delete a selected node or connection from the Inspector. Deletion remains
   undoable.
7. Save downloads a complete root `nodesim-v1.json`, even from a nested view.
   Open validates the entire candidate before replacing the active document.

Pointer users may right-click an empty canvas to add at that position. After
selecting a source node, right-clicking another node offers compatible ports.
These pointer shortcuts do not replace the toolbar's keyboard path.

### Keyboard interaction

| Action | Shortcut |
| --- | --- |
| Add | `Alt+A` |
| Connect | `Alt+C`; create with `Alt+Enter` |
| Open | `Alt+O` or `Ctrl+O` / `Cmd+O` |
| Save | `Alt+S` or `Ctrl+S` / `Cmd+S` |
| Undo | `Alt+U` or `Ctrl+Z` / `Cmd+Z` |
| Redo | `Alt+R`, `Ctrl+Y` / `Cmd+Y`, or `Ctrl+Shift+Z` / `Cmd+Shift+Z` |
| Compact tabs | `Alt+1`, `Alt+2`, `Alt+3`; arrow keys move between tabs |
| Canvas add menu | `Context Menu` or `Shift+F10` |

Menus accept arrow keys, Home, End, Enter, and Space. Escape closes a menu and
restores focus. Operating-system file-picker keyboard behavior belongs to the
host OS and requires manual acceptance.

## Formula grammar

Formulas consume the entire input. Unknown characters, trailing tokens,
non-finite results, division by zero, missing references, and incompatible
types produce structured errors.

```ebnf
expression     = additive ;
additive       = multiplicative, { ("+" | "-"), multiplicative } ;
multiplicative = prefix, { ("*" | "/"), prefix } ;
prefix         = [ "-" ], primary ;
primary        = number | reference | function-call | "(", expression, ")" ;
function-call  = ("sum" | "min" | "max"), "(", expression,
                 { ",", expression }, ")" ;
reference      = identifier, [ ".", identifier ] ;
identifier     = (letter | "_"), { letter | digit | "_" } ;
number         = digits, [ ".", digits ] | ".", digits ;
```

Unary minus is supported; unary plus, scientific notation, strings,
assignment, implicit multiplication, and arbitrary JavaScript are not. A
single-output source is `nodeId`; named outputs use `nodeId.outputId`. Labels
are display text, not formula identities.

## Document schema and migration

The authoritative artifact is `GraphDocument` schema version `1`:

```text
schemaVersion: 1
settings.simulation.horizonMonths: integer 1..1200
graph.nodes: authored discriminated nodes
graph.edges: authored endpoints, ports, weight, and lagMonths
```

Only authored state is serialized. Computed values, timeseries caches,
selection, hover, validation overlays, and workspace layout are excluded.
Limits are 5 MiB per import, 1,000 nodes and 5,000 edges per graph, nesting depth
8, and 4,096 characters per formula. IDs are unique within a graph scope and
all endpoints, ports, custom bindings, numbers, and schema versions are
validated before mutation.

Unversioned legacy documents migrate deterministically to version 1. Migration
adds explicit simulation settings, edge weight/lag defaults, stable output
ports, and formula-safe output identities. The original legacy import text is
retained separately after it parses, and a failed import leaves the active
document untouched.

## Simulation semantics

- Income and expense values normalize to monthly flows from day (`×30`), week
  (`×52/12`), month (`×1`), or year (`×1/12`). Expenses must be non-negative;
  the current schema and engine accept finite signed income amounts.
- Add/subtract require matching types. Multiply supports scalar/scalar and
  scalar/monthly-flow. Divide supports scalar/scalar and monthly-flow/scalar.
- Edge weight is finite and non-negative and applies before lag. Scalar edges
  cannot have a non-zero lag.
- Assets apply nominal annual rate divided by 12 to the opening balance, then
  add the end-of-month contribution. The emitted balance has exactly the
  document horizon's number of samples.
- Output nodes report the first one-based month at which combined asset balance
  reaches the target, or the tagged `unreachable` state.
- Cycles diagnose members; downstream nodes are blocked without substituting
  zero. Unrelated components continue to compute.

All numbers must remain finite. Current calculations use IEEE-754 and are a
prototype; deterministic decimal/fixed-point money remains required before
financial-decision use.

## Autosave, recovery, and accessibility

Every valid authored transaction schedules autosave after 250 ms. Saving writes
and validates a temporary envelope, retains the previous current envelope as
last-known-good, replaces current, validates readback, then removes temporary.
Load order is current, interrupted temporary, last-known-good, then demo.
Recovery status is announced; legacy `econgraph.document.v1.*` records remain
readable while new saves use `nodesim.document.v1.*`.

These are the implemented steps, not a complete crash-recovery guarantee. A valid
current record wins even if the temporary record has a newer revision. There is
no page-exit flush or cross-tab conflict handling, and unavailable storage can
currently prevent startup. Export important work with **Save**. Recovery hardening
is tracked in [R1](PROJECT_REVIEW.md#r1-recovery-and-storage-failures).

The toolbar and semantic tree provide a non-canvas authoring path. Menus manage
focus, errors are exposed in the Inspector and restrained live regions, and the
UI supports focus-visible, reduced-motion, forced-colors, responsive tab mode,
and retained contrast/width evidence. Stage 7 evidence does not claim manual
screen-reader speech output or operating-system picker acceptance; those remain
human gates.

## Known authoring limitations

- **Custom ports:** Add Input / Add Output currently submit an empty binding and
  are rejected. Changing a port's type and binding may also require a combined
  transaction that the current controls cannot express. Do not remove document
  validation or silently create bound nodes to work around this. Existing valid
  imported ports remain usable. See [R2](PROJECT_REVIEW.md#r2-custom-port-authoring).
- **Nested results:** opening a custom graph recomputes it using local defaults,
  without the parent instance's injected inputs. The demo's Adjusted node shows
  `0` inside while Savings Adjuster produces `1350` at root. The hierarchy also
  loses derived values for inactive scopes. Root computation and document export
  remain separate from this presentation gap. See [R3](PROJECT_REVIEW.md#r3-nested-computation-context).
- **Numeric drafts:** an invalid entry blurred out of a field is replaced by the
  last authored value while its error remains displayed. Escape cancels a draft.
  See [R9](PROJECT_REVIEW.md#r9-numeric-draft-feedback).
- **History:** undo/redo retains up to 100 commands in this session; history itself
  is not persisted. Node positions and root node scale are authored state; panel
  layout, theme, selection, and navigation are browser/session preferences.

## Implementation architecture

[`GraphDocumentStore`](../src/document/documentStore.ts) owns authored root
documents, command revisions, and undo/redo. Each graph command converts a copy
through [`graphDocument.ts`](../src/document/graphDocument.ts), validates it, and
only then replaces the active document. `AuthoredNodeData` is a discriminated
union; `EconNodeData` / `GraphData` are permissive runtime and legacy shapes, not
the persistence contract. Invalid formulas may be authored and saved as text;
the engine diagnoses them without emitting a numeric result.

[`App.tsx`](../src/App.tsx) subscribes to document revisions, projects the active
scope into [`createCytoscape.ts`](../src/graph/createCytoscape.ts), and debounces
storage writes. The adapter emits commands for pointer edits and owns rendering
resources through `ControllerLifecycle`; it is not the document authority.
`graphScope.ts` addresses nested graphs with immutable arrays of custom-node IDs.

[`computeGraph.ts`](../src/engine/computeGraph.ts) evaluates a graph with explicit
simulation settings, applies edge transforms, injects custom inputs during root
evaluation, and returns derived values plus scoped diagnostics. `formula.ts`
parses without evaluating JavaScript. `connectionValidation.ts` checks candidate
connections. [`tests/`](../tests) exercises these core seams; its lifecycle tests
use a fake graph, and the retained Stage 7 browser reports have no rerunnable
browser test command in this checkout.
