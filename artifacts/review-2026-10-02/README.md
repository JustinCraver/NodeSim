# Unfinished-review follow-up receipt — 2026-10-02

Local work in `F:\AnnexedGames\NodeSim`, `main`, clean baseline
`3edb13a5b44ddb5d3276a600987901bc663d192b`, including this task's uncommitted
changes. The user requested every unfinished item in
[PROJECT_REVIEW.md](../../docs/PROJECT_REVIEW.md). R1/R2 were already complete.
No dependencies/lockfile or approved semantics were changed. No install, commit,
push, publication, deployment, or repackaging of retained releases occurred.
Packaging tests create disposable fixtures, not production candidates.

Space sync: not applicable — no declared repository association was found.

## Current handoff

| Item | Work completed and remaining requirement |
| --- | --- |
| R3 | Owner choice was requested: live root-instance results or an explicitly separate isolated preview. No answer was assumed; implementation and repeated-ID consistency assertions remain pending. |
| R4 | Completed staged/hash-verified packaging, exclusive fresh output, path/overlap/link/metadata checks, build-recorded provenance, and manifest-bound SHA256SUMS. 26 fault/subprocess regressions pass. |
| R5 | [Concrete proposed precision ADR](../../docs/adr/0002-money-precision.md) prepared and shown for owner review. It defines representation, scales, rounding, range, exact examples, v1 preservation and explicit v2 migration. Approval, implementation, and product acceptance remain pending. |
| R6 | Read-only origin verifier implemented with 16 mock-transport/CLI regressions, including content/MIME/hash, redirect/TLS, header/cache/revalidation, receipt preservation, and linked-path protection. Actual host, clean hosted candidate/preceding artifact, deployment/rollback and prerequisite acceptance remain pending. |
| R7 | Offline license reporting completed with 9 regressions. Required/applicable missing or mismatched installations and unknown/nonallowlisted licenses still fail. Current live registry permission was requested; owner license review/authorized hosted acceptance remain pending. Upgrade-required outdated and high/critical advisory policy retained. |
| R8 | One repeatable browser command covers recovery/ports/numeric drafts/general authoring, with exact file/history/reload/remount comparisons. Stable visible labels fixed in shared numeric fields and connection pickers. R3 assertions and human accessibility/readability acceptance remain pending. |
| R9 | Completed rejected-draft preservation, explicit parent commit outcomes, Escape, external revision/history, and scoped selection reset in Inspector/horizon. Original failure and corrected desktop/compact evidence retained. |
| R10 | Completed measured lazy resources, same-scope selection without reprojection, stable incremental elements and pan/zoom preservation. Existing validation/history retained; broader unmeasured candidate caching was not introduced. |

## Final verification

Windows, Node `v24.18.0`, npm `11.16.0`, existing locked installation.

| Check | Actual result |
| --- | --- |
| Final `npm.cmd run ci:verify` | PASS: 17 files / 187 tests, also under coverage; typecheck, lint, dependency-major gate, production build, all bundle budgets, synthetic local path/reference/header smoke. |
| Core coverage | 93.48% transformed bytes / 85.82% functions across 10 core modules; 80%/80% thresholds unchanged. React/controller browser coverage is separate. |
| Normal-run core benchmarks | 4,000-node compute 18.73 ms / 750 ms; 1,000 nodes and 25 move/Undo/Redo rounds 110.88 ms / 3,000 ms. |
| Final bundle | 84 modules; total raw 795,128 / 870,400 bytes; JS raw 768,849 / 819,200; JS gzip 242,720 / 256,000; CSS raw 24,885 / 40,960. Existing Vite size and transitive `pathe`/`react-is` notices retained. |
| Final consolidated browser command | [PASS receipt](browser-matrix-final/receipt.json), dedicated `127.0.0.1:5199/NodeSim/`, fresh Chromium `151.0.7922.34` contexts. Recovery, custom-port, numeric-draft, and general authoring suites all exit 0 with passing retained subreceipts. Desktop 1440×1000 and compact 390×844 workflows and no page/console errors. |
| Final rendered inspection | Desktop/compact numeric rejection, custom-port draft, and post-remount authoring/semantic screenshots inspected. Error and draft agree; controls/semantic text remain visible and panels scroll without horizontal document overflow. This grants no human compact readability/accessibility acceptance. |
| Offline license command | Expected FAIL (exit 1): [report](licenses.json) has 122 installed rows, 22 known incompatible optional omissions, one remaining `caniuse-lite@1.0.30001765: CC-BY-4.0` owner-review finding. No registry request or allowlist expansion. |
| Read-only target check | [Pages observation](pages-origin-observation.json): HTTP/HTTPS 404 and no matching header contract; HTTPS TLS peer authorized. This is an anonymous host observation, not clean candidate or rollback acceptance. |
| Final diff/docs | Intentional source/scripts/tests/docs/new evidence reviewed; diff whitespace and local documentation links checked. Pre-existing working tree was clean; dated R1/R2/Stage 7/8 and retained releases preserved. |

Reproduce the browser command with the already available Playwright runtime;
instructions are in the [runbook](../../docs/RELEASE_OPERATIONS.md#consolidated-browser-verification).
The new commands do not install a browser/dependency or change CI acceptance.

## R10 measured interactions

The development-only runner instruments module responses in one fresh browser,
using a 153-node connected/two-level document. Product source/bundles contain no
profiling globals. Exact complete root export after the edit/Undo sequence matches
its baseline; errors remain absent.

| Measurement | [Original](profile-before/receipt.json) | [Final optimization](profile-after-2/receipt.json) |
| --- | ---: | ---: |
| Store constructions before / after selection+edit sequence | 5 / 49 | 1 / 1 |
| Compute calls before / after 11 selection actions | 7 / 40 | 7 / 7 |
| Node element identity through edits/Undo | Recreated | Retained |
| Zoom/pan through edits/Undo | Changed from authored test viewport | Exact `0.8`, `{x:77,y:88}` retained |
| Observed median selection time | 174.7 ms | 168.6 ms |
| Observed median field edit time | 146.6 ms | 133.4 ms |

These timing samples include browser interaction/frame waits and are local,
variable observations, not portable performance budgets. The intermediate
[profile-after-1](profile-after-1/receipt.json) is retained; it removed unused
stores/recreated elements but still recomputed for selection, before the final
same-scope selection shortcut. Root validation/history and derived recomputation
on actual authored edits were preserved.

## Retained failures and corrections

- `numeric-before`: wrapping-label text changed the exact label lookup after an
  error; screenshot also shows original restored text with a remaining error.
- `numeric-before-2`: an immediate read raced React updates. The runner now waits
  for two animation frames before checking rejected text and explicitly waits for
  history values; the original action deadline remains.
- [numeric-before-3](numeric-before-3/receipt.json): reproduced `4000 !== '-'`
  after invalid blur settled. This is the original R9 product defect.
- `numeric-after-1`: desktop checks passed; compact hidden hierarchy lookup timed
  out. The runner uses its rendered semantic DOM and the actual Graph tab.
  [numeric-after-2](numeric-after-2/receipt.json) and final matrix pass.
- `authoring-1`: initial export ran before toolbar startup; startup now waits for
  the horizon control. `authoring-2`/`authoring-3` used guessed connection labels;
  source/rendered controls were checked. `authoring-4` reproduced connection
  labels including all option text. Explicit visible-label associations corrected
  the product UI; [authoring-5](authoring-5/receipt.json) and final matrix pass.
- The first restricted packaging test assertions passed but Vitest cache writing
  failed with EPERM; a restricted browser evidence-directory creation also failed.
  Unchanged work ran in the permitted host context. No ACL, assertions, deadlines,
  test budgets, machine security, or install settings were weakened.

Earlier receipts remain dated investigation evidence. The final matrix was run
again after the final explicit numeric outcome/scoped-key change. Registry
queries, hosted CI, real deployment/rollback, manual screen-reader/OS-picker
behavior, and real-user compact readability were not performed.

The goal is not complete: required owner decisions/external gates remain open in
the current review. Product/financial-decision use remains **NO-GO**.

## Continued preparation — 2026-10-02

The next goal turn made additional concrete progress without assuming the pending
product choices or release authorization:

- [Native transport receipt](native-transport-2/receipt.json): PASS, using actual
  loopback HTTP/TLS clients/servers. Trusted TLS/body evidence, independent
  untrusted-certificate rejection, a response above 5 MiB, and a continuously
  streaming request's 250 ms wall deadline were verified (observed 259.93 ms).
  The test CA was trusted only by a disposable child; machine trust/production
  settings were untouched. Owned listeners, private keys, and certificates were
  cleaned. This is expressly local transport fixture evidence.
- [First native failure](native-transport-1/receipt.json): retained installed
  OpenSSL's missing compiled default config path. The helper now passes its own
  explicit temporary config; no machine OpenSSL configuration changed.
- [Precision references](precision-reference-2.json): PASS as draft design evidence.
  Exact Fraction quotient/remainder and independent 100-digit Decimal half-even
  paths agree on five asset cases and all 2,418 samples, two 1,200-month cases,
  positive/negative cent ties, zero signs, normalization, guard-digit/weighted
  flow boundaries, and strict range/rounded-zero-divisor controls. The receipt
  binds the unapproved ADR hash; it implements no production engine.
- [Current v1 observation](precision-v1-observation-2.json): PASS as source-bound
  observation. Actual current v1 tenths contributions reach target 1 in month 11;
  the proposed cent contract gives month 10. In a disposable Map, a v1 reader
  recovered valid last-good and later replaced an unknown schema 2 current record.
  No real stored document was mutated. This prompted the proposal's separate v2
  namespace rule and [migration analysis](../../docs/MONEY_PRECISION_MIGRATION.md).

The first reference/observation files remain receipts for the earlier proposal.
The `-2` files bind the current clarified ADR and add expected structured engine
diagnostics plus pre-rounding negative expense/initial/target controls. No old
reference, observation, or failure receipt was overwritten.

The optional verification scripts passed lint; product source was unchanged in
this continued preparation, so the previous 187-test/build/browser receipt still
describes that source. R3/R5 decisions, R5 engine/schema implementation, authorized
registry/license review, hosted CI, host/deployment/rollback, and human gates remain
pending. No work was promoted to product/release acceptance.
