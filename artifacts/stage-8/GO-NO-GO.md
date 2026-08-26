# NodeSim 0.1.0 release decision: NO-GO

Date: 2026-08-25  
Source revision: `04a5dd4496ea97e2a9dc67f96e0530049166af0c` plus the uncommitted Stage 8 working tree  
Production base path: `/NodeSim/`  
Candidate URL: `https://justincraver.github.io/NodeSim/`

## Decision

**NO-GO for production.** The Stage 8 implementation and local automated proof
pass, but release acceptance is not complete:

1. Current npm advisory, outdated-package, and license checks were not run
   because this environment was not explicitly authorized to transmit dependency
   metadata. The `npm ci --offline` cache result is not a current advisory check.
2. The CI workflow exists but has not been pushed or executed on GitHub.
3. No deployment was authorized. The real HTTPS target, assets, redirects, TLS,
   cache behavior, and origin security headers are unproven.
4. Stage 7 retained evidence explicitly leaves manual screen-reader speech and
   operating-system file-picker keyboard acceptance open.
5. The local 0.1.0 manifest correctly records `sourceDirty: true`; it is proof
   output, not a promotable clean-revision artifact.
6. The direct `react-resizable` major duplication was removed. Two multi-major
   families remain transitively (`pathe` 1/2 and `react-is` 16/18) and require an
   authorized dependency update/review rather than unsafe overrides.

## Local automated evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Toolchain | PASS | Node `v24.18.0`, npm `11.16.0` |
| Pinned clean install | PASS, offline cache | Isolated temporary copy completed `npm ci --offline`; no registry request was permitted |
| Typecheck | PASS | `tsc --noEmit` |
| Lint | PASS | syntax, merge-marker, focused-test, and TypeScript-suppression rules |
| Tests | PASS | 11 files, 93 tests |
| Coverage | PASS | 92.23% V8 transformed bytes and 82.4% functions across all 9 required core modules; thresholds are 80%/80% |
| Dependency majors | PASS with notices | no direct dependency duplicates another installed major; transitive notices listed above |
| Production build | PASS | 81 modules transformed; Vite's advisory for a chunk over 500 kB remains visible |
| Bundle budget | PASS | 781,850/870,400 total raw; 757,790/819,200 JS raw; 238,979/256,000 JS gzip; 23,334/40,960 CSS raw bytes |
| Exact-path smoke | PASS locally | `/NodeSim/` returned 200, `/` returned 404, and both generated assets returned 200 |
| Header contract | PASS locally | every local response matched `deployment/security-headers.json` |
| Diff hygiene | PASS | `git diff --check` returned no errors |

The same `ci:verify` chain passed both in the working tree and in the isolated
offline-install copy. These are automated local results, not hosted-CI or live-
deployment evidence.

## Release and rollback artifacts

Current validation artifact:

- Directory: `artifacts/releases/nodesim-v0.1.0/`
- Zip: `artifacts/releases/nodesim-v0.1.0.zip` (247,586 bytes)
- Zip SHA-256: `7028CA7EB6D0C7A698D5C97698E22F295318D36F10F5E5C3F8E189C9C1B287D9`
- Manifest: product `NodeSim`, version `0.1.0`, base `/NodeSim/`, three hashed files, `sourceDirty: true`

Rollback baseline retained before Stage 8 edits:

- Directory: `artifacts/releases/nodesim-v0.0.0/`
- Zip: `artifacts/releases/nodesim-v0.0.0.zip` (247,795 bytes)
- Zip SHA-256: `B1C5DD24E502838267E0EFCDBF5599056C05DFEA7214C13196FB5EE60B17399F`
- Source: pre-Stage-8 `04a5dd4`; title remains the legacy `EconGraph`

`current-artifact-smoke.json` records the 0.1.0 path/assets/header proof.
`rollback-artifact-smoke.json` records restoration of the preceding retained
artifact at the same `/NodeSim/` mount with all files returning 200. This proves
local artifact substitution; it does not prove a real production rollback.

## Source-control review

`main` and `origin/main` are both at `04a5dd4`; ahead/behind is `0/0` and
`origin/main..HEAD` contains no commits. Therefore there are no unpublished local
commits to review or push. The working tree contains only the uncommitted Stage 8
implementation and evidence. Nothing was committed, pushed, published, or
deployed.

## Conditions required to change NO-GO to GO

1. Review and commit the intended Stage 8 changes so the rebuilt manifest is
   `sourceDirty: false`.
2. Run the hosted CI workflow successfully from that exact revision.
3. In the explicitly authorized `dependency-review` environment, pass current
   advisory, outdated-package, license, and remaining duplicate-major review.
4. Obtain the outstanding manual accessibility/file-picker acceptance.
5. Explicitly authorize deployment, retain the currently deployed artifact,
   publish the already-built `site/` at `/NodeSim/`, and validate the real HTTPS
   URL, every asset, TLS/redirect/cache behavior, and exact response headers.
6. Restore the preceding immutable artifact at the real target, rerun the same
   live smoke, then restore the approved current artifact.
