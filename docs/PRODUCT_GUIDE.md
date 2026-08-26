# NodeSim product and authoring guide

## Product identity and setup

NodeSim is the canonical product name in the interface, package metadata,
exports, documentation, and release artifacts. Browsers with data under the
legacy `econgraph.*` local-storage keys remain readable; new writes use
`nodesim.*` keys.

Install the exact Node.js `24.18.0` and npm `11.16.0` toolchain, clone the
repository, and run:

```powershell
npm.cmd ci --no-audit
npm.cmd run ci:verify
npm.cmd run dev
```

The development server listens only on `127.0.0.1`. Use `dev:lan` only when
trusted-LAN access is intentional.

## Authoring workflows and gestures

Use the visible **Add**, **Connect**, **Open**, **Save**, **Undo**, and **Redo**
controls for the complete authoring path.

1. Add a node and select it in the canvas or semantic **Graph structure** tree.
2. Edit authored fields in the Inspector. Numeric drafts commit only when valid.
3. Connect two nodes with **Connect**; compatible asset/custom ports can be
   selected where required.
4. Double-click or double-tap a custom node to open its internal graph. Use the
   breadcrumb or **Back one level** to return.
5. Drag nodes to position them. Drag panel headers and resize handles in the
   desktop workspace; at 1024 px and below, use the Graph, Graph structure, and
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

- Income and expense values are non-negative monthly-flow magnitudes normalized
  from day (`×30`), week (`×52/12`), month (`×1`), or year (`×1/12`).
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

The toolbar and semantic tree provide a non-canvas authoring path. Menus manage
focus, errors are exposed in the Inspector and restrained live regions, and the
UI supports focus-visible, reduced-motion, forced-colors, responsive tab mode,
and retained contrast/width evidence. Stage 7 evidence does not claim manual
screen-reader speech output or operating-system picker acceptance; those remain
human gates.
