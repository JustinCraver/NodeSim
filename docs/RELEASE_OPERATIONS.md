# NodeSim release, deployment, and rollback runbook

## Release contract

- Product: **NodeSim**
- Version source: `package.json`, using semantic versioning
- Production base path: exactly `/NodeSim/` (case-sensitive, leading and
  trailing slash required)
- Candidate project-site URL derived from the Git remote:
  `https://justincraver.github.io/NodeSim/`
- Artifact: `artifacts/releases/nodesim-v<version>/`, containing `site/`,
  `release-manifest.json`, and `SHA256SUMS`

The URL is a target contract, not evidence of a deployment. No workflow in this
repository deploys. Publishing the artifact or enabling a Pages source requires
explicit authorization. The current GitHub Pages origin must also be verified
against the header contract below; repository files alone cannot be assumed to
configure origin response headers.

The [2026-08-25 NO-GO report](../artifacts/stage-8/GO-NO-GO.md) and smoke JSON are
historical receipts. Its Git status, hashes, and local artifact paths describe
that run. Use [the current review](PROJECT_REVIEW.md) for later findings; neither
report establishes hosted-CI success or a present deployment.

## Clone-to-artifact procedure

From a clean checkout with Node.js `24.18.0` and npm `11.16.0`:

```powershell
npm.cmd ci --no-audit
if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
npm.cmd run ci:verify
if ($LASTEXITCODE -ne 0) { throw 'Verification failed' }
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$releaseDirectory = Join-Path 'artifacts/releases' "nodesim-v$releaseVersion"
if (Test-Path -LiteralPath $releaseDirectory) { throw "Artifact already exists: $releaseDirectory" }
npm.cmd run release:package
```

Packaging now enforces a new destination strictly inside `artifacts/releases/`.
Existing directories/files, path links, source/output overlaps, invalid/reserved
path segments, unknown/duplicate options, and metadata overrides fail before
writes. `--site` must resolve inside this repository; `--output` must be a fresh
release directory. For local validation, choose a new name such as
`npm.cmd run release:package -- --output artifacts/releases/review-20261002`.
Only this run's owned stage/reservation is cleaned on failure; old artifacts stay
intact. Copy/hash checks finish before exclusive output creation; the manifest
is finalized last. A forced process termination can leave an incomplete owned
stage/reservation; retain/inspect it before choosing a different fresh directory.

`npm run build` records base path, package version, source Git revision/dirty
state, and site-file hashes in `dist/nodesim-build.json`. Packaging requires that
receipt, the exact production base, and matching package version/files. Running
`vite build` directly produces no qualifying receipt. `NODESIM_BASE_PATH` builds
are useful locally but a non-production base cannot be packaged as a release.
Version/revision/dirty overrides are unsupported, including for historical files.
Keep preceding releases and their original metadata; never reconstruct them from
current source. See [R4](PROJECT_REVIEW.md#r4-immutable-release-packaging).

`ci:verify` requires typecheck, lint, the deterministic regression suite, V8
transformed-byte/function coverage thresholds, no duplicate major introduced by
a direct dependency, production build, raw/gzip bundle budgets, and a local
HTTP smoke of `/NodeSim/` plus every generated asset and HTML entrypoint reference.
Coverage is aggregate transformed-source coverage of exercised core `.ts` modules;
it does not measure React/TSX authoring or a real controller mount.

The release manifest binds product, version, base path, build-recorded source
revision/dirty state, file sizes, and SHA-256 hashes. `SHA256SUMS` includes site
files and the release manifest itself. A production release requires
`sourceDirty: false`; a dirty local artifact is validation evidence only.

## Recovery browser verification

R1 has an optional focused browser check in
`scripts/recovery-browser-check.mjs`. It uses a separately available Playwright
runtime and browser; it does not add a dependency or install either. Run Vite on
a dedicated loopback port, then run the check from another terminal:

```powershell
npm.cmd run dev -- --port 5197 --strictPort
# In another terminal; omit this variable if Playwright is already resolvable:
$env:PLAYWRIGHT_MODULE_PATH = '<absolute path to the available playwright package>'
node scripts/recovery-browser-check.mjs http://127.0.0.1:5197/NodeSim/ artifacts/recovery-browser
```

The runner uses fresh browser contexts, leaving normal browser documents alone.
It injects newer temporary/invalid namespace records, blocked storage access,
quota failures, and missing Web Locks. It checks export downloads, recovery,
retry, real tab conflicts, explicit reload/Undo, pending-edit lifecycle handlers,
and desktop/390 px compact presentation. Screenshots and `receipt.json` go to the
chosen directory. Use a fresh output directory for evidence you intend to retain.
This command is focused local R1 evidence; it is not part of hosted CI, does not
prove forced-process crash durability, and does not close manual accessibility
or the broader browser matrix in R8. Core fault tests remain in `ci:verify`.

## Custom-port browser verification

R2 has a focused optional runner at
[`scripts/custom-ports-browser-check.mjs`](../scripts/custom-ports-browser-check.mjs).
It uses the same separately available Playwright runtime/browser as the recovery
runner and installs no dependencies. Use a dedicated loopback origin and a fresh
output directory:

```powershell
npm.cmd run dev -- --port 5198 --strictPort
# In another terminal; omit this variable if Playwright is already resolvable:
$env:PLAYWRIGHT_MODULE_PATH = '<absolute path to the available playwright package>'
node scripts/custom-ports-browser-check.mjs http://127.0.0.1:5198/NodeSim/ artifacts/custom-ports-browser
```

Fresh desktop and 390 px browser contexts exercise the rendered React Inspector
and real controller. Checks cover keyboard add/edit/remove for input and output
ports, combined type/binding edits, strict candidate rejection, cancellation,
pending-draft unload protection, compatible/incompatible connections, one edge
per keyboard activation, Undo/Redo, JSON file import/export, explicit graph repair,
and nested scopes with repeated local IDs. The runner checks exports against
complete expected root documents and retains screenshots and `receipt.json`,
including a failure screenshot when possible. Inspect those screenshots; a
passing command alone is not rendered layout acceptance.

This is focused local authoring evidence. It does not complete R3's instance
computation work, the broader R8 matrix, manual screen-reader/OS-picker checks,
hosted CI, dependency advisory review, or deployment acceptance. Dated R1 and
Stage 7/8 evidence remains unchanged.

## Security and dependency review

Every response under `/NodeSim/` must carry the exact values in
`deployment/security-headers.json`. The HTML also contains a CSP and referrer
fallback, but meta tags do not replace origin headers. TLS must be valid and
HTTP must redirect to HTTPS before HSTS is accepted.

The normal CI token is read-only. `deps:audit` and `deps:outdated` query the live
registry and require the authorized environment. `deps:licenses` reads the
lockfile and installed `package.json` files locally and sends no registry requests.
It reports known incompatible optional OS/CPU omissions separately; missing
required/applicable installations, malformed manifests, mismatched installed
versions, and unknown/nonallowlisted licenses still fail. The October Windows
run reports 122 installed manifests, 22 expected omissions, and the remaining
`caniuse-lite` / `CC-BY-4.0` license finding. This offline result does not establish
current vulnerability status or a fresh clean-install result. See
[R7](PROJECT_REVIEW.md#r7-dependency-review-signal).

The authorized workflow retains an explicit **upgrade-required** outdated policy:
any `npm outdated` finding fails its gate. There is no implicit reviewed exception
or advisory/license waiver. A requested exception must first have an owner-approved
policy specifying package/version, reason, expiry, and retained review evidence;
that policy needs implementation before it can change a gate. The high/critical
advisory gate stays unchanged. Before dispatching **Authorized dependency review**:

1. Configure the GitHub `dependency-review` environment with required reviewers.
2. Confirm the environment is authorized to transmit the lockfile's dependency
   requests to npm.
3. Dispatch the workflow and retain its logs with the release evidence.
4. Resolve every high/critical advisory or record a reviewed, time-bounded
   exception. Review outdated majors and every non-allowlisted/missing license.

Dependabot opens grouped monthly npm and GitHub Actions updates. Direct
`react-resizable` was removed because NodeSim used only its CSS while
`react-grid-layout` already supplies the compatible runtime major. Remaining
multi-major `pathe` and `react-is` copies are transitive development/runtime
implementation details and must be reevaluated by the authorized update run;
they are not forced with unsafe overrides.

## Bundle and path budgets

The artifact must remain within these uncompressed/gzip ceilings:

| Budget | Limit |
| --- | ---: |
| Total raw files | 850 KiB |
| JavaScript raw | 800 KiB |
| JavaScript gzip | 250 KiB |
| CSS raw | 40 KiB |

Raise a budget only in a reviewed change that explains the user-visible value.
With the production base, the smoke requires `/` to return 404 and rejects
escaped asset URLs, missing files, an incorrect product title, and missing or
changed security headers.

Here, "smoke" means `scripts/deployed-smoke.mjs` serving a **local directory** on
an ephemeral loopback HTTP server. Supported options are `--site`, `--base`,
`--title`, and `--output` (JSON evidence file). Production proof uses the default
`/NodeSim/` base; a custom `--base` is a local test override. The server itself
injects `security-headers.json`, including HSTS over local HTTP. That checks the
contract/fixture, not TLS, HSTS acceptance, or origin configuration. The script
does not execute JavaScript, check CSS imports, or accept a real-origin URL;
unsupported options now fail instead of being silently ignored.
New JSON smoke receipts explicitly identify their evidence kind as
`synthetic-local`.

## Consolidated browser verification

The optional `browser:verify` command requires an already available Playwright
runtime/browser and installs nothing. Start Vite at a dedicated loopback origin,
then run from another terminal with a **fresh** output directory whose parent
already exists:

```powershell
npm.cmd run dev -- --port 5199 --strictPort
# Separate terminal; omit when Playwright is already resolvable:
$env:PLAYWRIGHT_MODULE_PATH = '<absolute path to the available playwright package>'
npm.cmd run browser:verify -- http://127.0.0.1:5199/NodeSim/ artifacts/browser-review-20261002
```

The command runs recovery, custom-port, numeric-draft, and general authoring suites
serially, each with fresh browser contexts. It requires retained passing receipts,
stops on failure, and keeps screenshots and the aggregate/subsuite results. It
covers real React/Cytoscape keyboard add/connect/fields, valid and rejected
commands, nested authored edits, root JSON import/export, exact history, actual
autosave/reload, and desktop/390 px compact remount. Numeric checks cover invalid
blur/Enter, parent rejection, Escape, external Undo/Redo, selection, horizon, and
associated error text. Inspect retained desktop/compact screenshots.

This local Chromium path is separate from `ci:verify` core coverage, hosted CI,
and human acceptance. R3's instance-result assertions await its explicit view
decision and implementation. Record manual screen-reader speech, OS file-picker
behavior, and real-user compact label/semantic-alternative findings separately;
automation and no overflow cannot grant those gates.

For repeatable R10 profiling, use the same origin and a fresh output:

```powershell
node scripts/editor-profile-browser.mjs http://127.0.0.1:5199/NodeSim/ artifacts/editor-profile-20261002 --expect-optimized
```

This development-only runner instruments module responses in its isolated browser,
imports a 153-node connected/two-level fixture, measures selection/field samples,
and asserts one store per mount, stable same-scope node identity, preserved pan/zoom,
and exact Undo/root export. It adds no product profiling globals. Measurements are
local samples, separate from existing engine/store benchmarks.

## Read-only real-origin verification

After the host, clean candidate, dependencies, hosted CI, and manual gates are
approved and deployment is explicitly authorized, verify the deployed bytes:

```powershell
npm.cmd run verify:origin -- --url https://<approved-host>/NodeSim/ --artifact artifacts/releases/nodesim-v<version> --output artifacts/origin-<version>-fresh.json
```

The command publishes nothing. It requires `sourceDirty: false`, exact `/NodeSim/`,
matching local files and `SHA256SUMS` that also binds the manifest. It checks HTTP
redirecting to the exact HTTPS entrypoint, authorized TLS, bounded same-origin/path
redirects, every file's bytes/hash, entrypoint references, exact response headers,
cache behavior, and conditional revalidation. Hashed `-<hex>.js/css` resources
require public positive max-age plus immutable caching; HTML and unversioned
resources (including `nodesim-build.json`) must revalidate or use no-store. A
revalidation response must preserve security/cache policy and match the artifact
or legitimately return 304. TLS disabling and evidence output inside the immutable
artifact are rejected. Existing evidence files are preserved. Requests have a
10-second ceiling within a 60-second verification deadline; failures retain a
failure receipt when a fresh output was reserved.

Both the candidate and preceding deployed immutable artifact need independent
passing receipts bound to their manifest hashes. Historical artifacts lacking a
manifest hash or clean provenance cannot meet this verifier's current contract;
retain them without retrofitting metadata or claiming current acceptance. The
October read-only Pages observation returned 404/mismatched headers and establishes
no candidate/host/rollback acceptance. Host selection and deployment remain pending.

An optional native transport fixture check supplements the mocked unit tests.
It requires an already installed OpenSSL supporting `req -noenc/-addext` and
installs nothing:

```powershell
node scripts/origin-transport-check.mjs artifacts/native-transport-fresh --openssl '<existing-openssl-executable>'
```

It creates temporary loopback certificates/keys from an explicit disposable config
and trusts one fixture CA only in a disposable child process. It checks authorized
TLS/body evidence, HTTP redirect location, untrusted-certificate rejection, the
5 MiB streaming cap, and wall timeout under continuous streaming. All sockets and
private fixture keys are cleaned. It changes no machine trust store or production
verifier environment. The receipt is labeled `native-loopback-transport-fixture`
with `productionAcceptance: false`; existing output is rejected. It is local
transport evidence, not an actual candidate/preceding origin proof.

## CI artifact retention and versioning

CI retains each versioned artifact for 30 days. Production operations must copy
the promoted artifact and its CI logs to a release store that retains:

- every active production artifact;
- the immediately preceding version for instant rollback;
- failed artifacts and logs for at least 30 days;
- manifests and SHA-256 lists for as long as the corresponding release exists.

Never overwrite an existing semantic version. Increment patch for compatible
fixes, minor for backward-compatible features/schema readers, and major for a
deliberately incompatible public artifact or document contract. Schema version
changes remain independent and require a tested migration.

## Authorized deployment

Only after explicit authorization:

1. Select the clean (`sourceDirty: false`) artifact whose manifest version and
   commit were approved.
2. Verify `SHA256SUMS` before upload.
3. Retain the currently deployed artifact as the rollback candidate.
4. Publish `site/` without rebuilding it, mounted exactly at `/NodeSim/`.
5. Configure the origin/edge to emit `deployment/security-headers.json`.
6. Run `verify:origin` against the immutable uploaded artifact, retaining its
   hash-bound receipt. Choose an origin that emits the exact header/cache contract;
   source or local synthetic smoke does not establish that capability. Actual
   candidate/preceding proof remains [R6](PROJECT_REVIEW.md#r6-real-origin-release-proof).
7. Grant GO only after dependency, manual accessibility, and product gates are
   also accepted.

## Rollback proof and production rollback

Rollback uses an immutable preceding artifact, never a rebuild from an old tag.
For a local proof, run the smoke against both retained directories:

```powershell
node scripts/deployed-smoke.mjs --site artifacts/releases/nodesim-v0.0.0/site --base /NodeSim/ --title EconGraph
node scripts/deployed-smoke.mjs --site artifacts/releases/nodesim-v0.1.0/site --base /NodeSim/
```

Those example directories are ignored local artifacts retained during Stage 8;
a fresh clone does not contain them. Substitute actual retained, hash-verified
artifacts. Do not regenerate the supposed preceding version from current source.

For an authorized production rollback, atomically switch the `/NodeSim/` mount
to the preceding retained `site/`, purge only the HTML entry document from any
edge cache, then rerun the real-origin asset/header smoke. Keep the failed
artifact and logs. If the preceding artifact, exact hashes, or real-origin smoke
is unavailable, rollback is not proven and the release remains NO-GO.
