# NodeSim

NodeSim is a visual editor for advanced simulations.

## Supported toolchain

Use Node.js `24.18.0` (LTS) and npm `11.16.0`. The Node version is pinned in
`.nvmrc`; `package.json` pins and validates both tools.

```powershell
node --version
npm.cmd --version
npm.cmd ci
```

`package-lock.json` is part of the source tree and must remain committed.
`node_modules/`, `dist/`, and TypeScript build-info files are generated locally
and are intentionally not tracked. No deployment target is currently configured,
so deployment must use a fresh production build rather than committed `dist/`
files.

## Development server

The default server is intentionally limited to the local machine:

```powershell
npm.cmd run dev
```

To opt in to access from other devices on a trusted LAN, bind Vite to all
interfaces explicitly:

```powershell
npm.cmd run dev:lan
```

The LAN command exposes the development server to the network. Use it only on a
trusted network and stop it when testing is complete.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run check
```

`check` runs the typecheck followed by a production build.
