# R2 custom-port authoring receipt — 2026-10-02

Bounded local engineering verification in `F:\AnnexedGames\NodeSim`, branch
`main`, baseline `38a3e8e206b04d883cf04f2cf58d8563ed08682d`, including this task's
uncommitted changes. The baseline working tree was clean. No dependency install,
lockfile update, commit, push, release packaging, publication, or deployment was
performed. No project Space association was declared; no remote sync was attempted.

## Implemented behavior

Complete local input/output drafts commit type, identity, label, and an existing
compatible binding through one strict `update-custom-ports` command. Existing
port IDs stay fixed; output formula identities are explicit and validated.
Rejected drafts keep their text/error and leave authored history unchanged.
Removing ports or changing types removes only the relevant incompatible edges;
Undo/Redo restores the whole transaction. Binding candidates use authored type
inference, and explicit port types survive later commands and JSON round trips.

The Internal graph JSON draft has a separate, explicit binding-repair preview
and action. Only the action creates typed zero-value placeholders and applies
graph plus bindings atomically. Strict file import remains strict. Local port
drafts are not serialized, reset on authored revisions/scope changes, and protect
against unload while open. Apply/Cancel/Escape restore initiating-button focus.
Repeated labels use stable semantic port keys, and Alt+Enter on the connection
button executes once.

## Final verification

Windows, Node `v24.18.0`, npm `11.16.0`, existing locked dependencies.

| Check | Actual result |
| --- | --- |
| Original browser Add Input | REPRODUCED: `$.graph.nodes[3].custom.inputBindings.<new-id>: must be a non-empty string`; no port was added. Fresh headless context on the isolated origin. |
| Initial focused regressions before source edits | 3 failed / 4 passed: input/output type changes retained incompatible edges; monthly-flow arithmetic binding was absent. Same failures reproduced in permitted host context. |
| Expanded focused store/nested checks | PASS: atomic add/edit/remove, exact Undo/Redo, scoped root round trips, strict rejected candidates, explicit repair, lag compatibility, and declared asset-series type preservation. |
| Final `npm.cmd run ci:verify` | PASS: 14 files / 136 tests, also under coverage; typecheck, lint, dependency-major gate, build, bundle budgets, local smoke. |
| Core coverage | 93.48% transformed bytes / 85.82% functions across 10 modules; thresholds remain 80% / 80%. This excludes React/TSX UI coverage. |
| Normal-run benchmarks | 4,000-node compute 24.18 ms / 750 ms; 1,000-node, 25 move/Undo/Redo rounds 117.48 ms / 3,000 ms. No rendered-performance claim. |
| Final build/budgets | 84 modules; total raw 792,951 / 870,400 bytes; JS raw 767,340 / 819,200; JS gzip 242,272 / 256,000; CSS raw 24,885 / 40,960. Existing Vite size advisory and transitive `pathe`/`react-is` notices remain. |
| Final browser | [browser-13/receipt.json](browser-13/receipt.json): PASS, Chromium `151.0.7922.34`, dedicated `127.0.0.1:5198/NodeSim/`, fresh desktop 1440×1000 and compact 390×844 contexts. Ten grouped workflow checks, zero page/console errors. |
| Rendered inspection | Final desktop/compact drafts and nested-result screenshots inspected: visible labels, typed binding picker, focus, readable stacked controls, and no horizontal overflow. Controls below the panel viewport remain reachable through its scroll area/keyboard. |
| Documentation/diff hygiene | PASS: 53 local links/anchors across eight active documents/receipts; final lint and `git diff --check` clean. Diff reviewed; only this task's source, tests, docs, runner, and new receipts changed. |

The browser runner exercises keyboard add/edit/remove for both port directions,
combined type/binding changes, output identity rejection, asset-series connection,
one edge per Alt+Enter, port/edge Undo, Cancel/Escape/focus, external Undo, draft
unload protection, real JSON file import/export, explicit repair/Undo/Redo,
strict malformed-binding import rejection, and nested scopes with repeated IDs.
Every export comparison uses the complete root document. The reproducible command
is in the [runbook](../../docs/RELEASE_OPERATIONS.md#custom-port-browser-verification).

Final screenshots:

- [Desktop input draft](browser-13/desktop-input-draft.png)
- [Compact input draft](browser-13/compact-input-draft.png)
- [Desktop nested result](browser-13/desktop-nested-result.png)
- [Compact nested result](browser-13/compact-nested-result.png)

## Retained investigation history

Earlier receipts/screenshots are preserved; they are not final acceptance:

| Runs | Finding and correction |
| --- | --- |
| `browser-1`, `browser-2` | Immediate field reads and exact label matching exposed select labels containing option text. The runner waits for fields; the new selects now reference their visible labels explicitly. |
| `browser-3` | An explicitly declared timeseries output became scalar during legacy conversion. Migration now infers only omitted port types; the core/browser regressions retain an exact timeseries assertion. |
| `browser-4` | The runner tried to remove a port while connection creation had selected its edge. It now explicitly reselects the custom node through the semantic tree. |
| `browser-5`, `browser-6` | Undo mismatch traced to double Alt+Enter activation. The explicit single-edge probe reproduced `2 !== 1`. Button keyboard handling now stops propagation to the dialog; the assertion remains. |
| `browser-7` | The rapid export loop timed out waiting for a download. Repeated exports are now spaced 250 ms apart; every root comparison and the original 30-second action deadline remains, with no download retry. |
| `browser-8` | Undo of an edge left a port draft open because custom configuration bytes were unchanged. Drafts now reset on authored document revision as well as custom identity/configuration. |
| `browser-9`, `browser-10` | Import error text had three presentations, and an immediate form-count read raced React updates. The runner targets the visible file error and waits for draft detachment before asserting absence. |
| `browser-11` | All workflow checks ran, but duplicate port labels produced React key warnings. Semantic port summaries now key by direction plus authored port ID. The zero-error assertion remains. |
| `browser-12` | PASS, including Apply/Escape focus assertions. Screenshots included a native selection popup. |
| `browser-13` | PASS with the same assertions; Tab closes selection menus before final screenshots. |

Restricted execution also encountered the existing host-account Vitest cache
EPERM and artifact-directory EPERM. Commands were rerun in the permitted host
context without changing application settings, test budgets, or machine ACLs.

## Evidence boundary

This closes [R2](../../docs/PROJECT_REVIEW.md#r2-custom-port-authoring), not R3's
nested live-instance computation, R8's full browser matrix, manual accessibility
or OS-picker acceptance, precision, current advisory/license review, hosted CI,
real-origin headers, deployment, or rollback. Local smoke supplies its own
headers. Existing R1 and Stage 7/8 artifacts were preserved. Production and
financial-decision use remain NO-GO.
