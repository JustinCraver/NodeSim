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

## Clone-to-artifact procedure

From a clean checkout with Node.js `24.18.0` and npm `11.16.0`:

```powershell
npm.cmd ci --no-audit
npm.cmd run ci:verify
npm.cmd run release:package
```

`ci:verify` requires typecheck, lint, the deterministic regression suite, V8
transformed-byte/function coverage thresholds, no duplicate major introduced by
a direct dependency, production build, raw/gzip bundle budgets, and a local
HTTP smoke of `/NodeSim/` plus every generated asset.

The release manifest binds product, version, base path, source revision, dirty
state, file sizes, and SHA-256 hashes. A production release requires
`sourceDirty: false`; a dirty local artifact is validation evidence only.

## Security and dependency review

Every response under `/NodeSim/` must carry the exact values in
`deployment/security-headers.json`. The HTML also contains a CSP and referrer
fallback, but meta tags do not replace origin headers. TLS must be valid and
HTTP must redirect to HTTPS before HSTS is accepted.

The normal CI token is read-only. Dependency advisory, outdated-package, and
license checks are deliberately separate because they use current registry or
installed-package state. Before dispatching **Authorized dependency review**:

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
The smoke test rejects root-path deployment, escaped asset URLs, missing files,
incorrect product title, and missing or changed security headers.

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
6. Run the deployed smoke against the real HTTPS origin and record every asset
   status and header.
7. Grant GO only after dependency, manual accessibility, and product gates are
   also accepted.

## Rollback proof and production rollback

Rollback uses an immutable preceding artifact, never a rebuild from an old tag.
For a local proof, run the smoke against both retained directories:

```powershell
node scripts/deployed-smoke.mjs --site artifacts/releases/nodesim-v0.0.0/site --base /NodeSim/ --title EconGraph
node scripts/deployed-smoke.mjs --site artifacts/releases/nodesim-v0.1.0/site --base /NodeSim/
```

For an authorized production rollback, atomically switch the `/NodeSim/` mount
to the preceding retained `site/`, purge only the HTML entry document from any
edge cache, then rerun the real-origin asset/header smoke. Keep the failed
artifact and logs. If the preceding artifact, exact hashes, or real-origin smoke
is unavailable, rollback is not proven and the release remains NO-GO.
