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

Run packaging only when `artifacts/releases/nodesim-v<version>/` does not exist.
The current script **deletes an existing output directory before copying**, in
conflict with the immutable-version policy below. Until [R4](PROJECT_REVIEW.md#r4-immutable-release-packaging)
is fixed, inspect the exact destination first. For another local verification,
use a fresh, deliberately chosen directory under `artifacts/releases/`, for example
`npm.cmd run release:package -- --output artifacts/releases/review-20260907` only
if that directory is absent. Do not pass existing artifacts, the repository root,
or overlapping source/output directories. This is an operational workaround,
not an enforcement guarantee.

`ci:verify` requires typecheck, lint, the deterministic regression suite, V8
transformed-byte/function coverage thresholds, no duplicate major introduced by
a direct dependency, production build, raw/gzip bundle budgets, and a local
HTTP smoke of `/NodeSim/` plus every generated asset and HTML entrypoint reference.
Coverage is aggregate transformed-source coverage of exercised core `.ts` modules;
it does not measure React/TSX authoring or a real controller mount.

The release manifest binds product, version, base path, source revision, dirty
state, file sizes, and SHA-256 hashes. A production release requires
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

## Security and dependency review

Every response under `/NodeSim/` must carry the exact values in
`deployment/security-headers.json`. The HTML also contains a CSP and referrer
fallback, but meta tags do not replace origin headers. TLS must be valid and
HTTP must redirect to HTTPS before HSTS is accepted.

The normal CI token is read-only. `deps:audit` and `deps:outdated` query the live
registry and require the authorized environment. `deps:licenses` reads the
lockfile and installed `package.json` files locally and sends no registry requests.
It currently treats uninstalled optional packages for other platforms as failures;
the September Windows run also flags `caniuse-lite`'s `CC-BY-4.0` license for review.
See [R7](PROJECT_REVIEW.md#r7-dependency-review-signal). These are not evidence of a
live vulnerability. Before dispatching **Authorized dependency review**:

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
6. Use a separate real-origin verifier to check the HTTPS entrypoint and every
   referenced asset, response headers, redirects, TLS, and cache behavior. This
   capability is not implemented by `smoke:deployed`; implementing it and choosing
   an origin that supports the header contract remain [R6](PROJECT_REVIEW.md#r6-real-origin-release-proof).
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
