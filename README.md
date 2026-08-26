# NodeSim

NodeSim is a visual editor for typed financial simulation graphs. **NodeSim** is
the canonical product name; `EconGraph` is retained only as a legacy local-data
namespace that existing browsers can still read.

## Setup

Use Node.js `24.18.0` and npm `11.16.0`. Both versions are pinned in `.nvmrc`
and `package.json`; `package-lock.json` is authoritative.

```powershell
node --version
npm.cmd --version
npm.cmd ci --no-audit
npm.cmd run ci:verify
```

The default development server is loopback-only:

```powershell
npm.cmd run dev
```

`npm.cmd run dev:lan` binds to `0.0.0.0` and is only for an intentional trusted-
LAN test. Production builds use the exact `/NodeSim/` base path.

## Verification

`npm.cmd run ci:verify` runs typecheck, focused lint rules, deterministic tests,
V8 coverage thresholds, duplicate direct-major detection, production build,
bundle budgets, and deployed-path/header smoke tests. `npm.cmd run check` is the
shorter developer loop without coverage or deployment smoke.

Current advisory, outdated-package, and license checks may contact or depend on
registry state. Run `deps:audit`, `deps:outdated`, and `deps:licenses` only in an
explicitly authorized environment. The manual GitHub workflow uses the protected
`dependency-review` environment for that purpose.

## Documentation

- [Product and authoring guide](docs/PRODUCT_GUIDE.md)
- [Release, deployment, and rollback runbook](docs/RELEASE_OPERATIONS.md)
- [Approved semantic contract](docs/adr/0001-product-semantics.md)
- [Audit remediation roadmap](docs/AUDIT_REMEDIATION_ROADMAP.md)
- [Stage 7 rendered accessibility evidence](artifacts/stage-7/README.md)

NodeSim is a prototype. Its current IEEE-754 calculations are not approved for
financial-decision support until the ADR's fixed-point/decimal requirement is
implemented and separately accepted.
