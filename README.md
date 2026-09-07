# NodeSim

NodeSim is a visual editor for typed financial simulation graphs. **NodeSim** is
the canonical product name; `EconGraph` is retained only as a legacy local-data
namespace that existing browsers can still read.

## Setup

Use Node.js `24.18.0` and npm `11.16.0`. `.nvmrc` pins Node; `package.json`
pins both and rejects mismatched development toolchains. `package-lock.json`
is authoritative. The examples use Windows PowerShell; on other shells use `npm`.

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

Open the URL Vite prints, normally `http://127.0.0.1:5173/NodeSim/`.
`npm.cmd run dev:lan` binds to `0.0.0.0` and is only for an intentional trusted-
LAN test. Production builds use the exact `/NodeSim/` base path. To inspect a
build locally, run `npm.cmd run build`, then `npm.cmd run preview` and open
the printed URL with `/NodeSim/` appended if necessary.

## Verification

`npm.cmd run ci:verify` runs typecheck, focused lint rules, deterministic tests,
V8 coverage thresholds, duplicate direct-major detection, production build,
bundle budgets, and deployed-path/header smoke tests. `npm.cmd run check` is the
shorter developer loop without coverage or deployment smoke.

Coverage measures transformed bytes/functions in exercised core `.ts` modules,
not React UI coverage. The smoke serves `dist/` on a temporary loopback server;
it checks local files, HTML asset references, and synthetic response headers.
It does not open a browser or contact a deployed origin.

`deps:audit` and `deps:outdated` contact the registry; run them only in an
explicitly authorized environment. `deps:licenses` reads installed manifests
offline, but currently fails for absent optional platform packages and a license
outside its allowlist. See the [review](docs/PROJECT_REVIEW.md). The existing
manual dependency-review workflow is separate from `ci:verify`.

## Documentation

- [Product and authoring guide](docs/PRODUCT_GUIDE.md)
- [Release, deployment, and rollback runbook](docs/RELEASE_OPERATIONS.md)
- [Approved semantic contract](docs/adr/0001-product-semantics.md)
- [Audit remediation roadmap](docs/AUDIT_REMEDIATION_ROADMAP.md)
- [Current review and proposed priorities](docs/PROJECT_REVIEW.md)
- [Repository agent guidance](AGENTS.md)
- [Historical Stage 7 accessibility evidence](artifacts/stage-7/README.md)

NodeSim is a local browser prototype with typed computation, validated versioned
documents, autosave/recovery, nested navigation, and undo/redo. Custom-port
authoring and nested result presentation still have confirmed gaps. Its current
IEEE-754 calculations are not approved for financial-decision support until the
ADR's fixed-point/decimal requirement is implemented and separately accepted.
The roadmap's original audit and retained release reports are dated evidence,
not a claim that all planned work is either absent or accepted today.
