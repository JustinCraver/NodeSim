import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { BUILD_RECEIPT, inventorySite } from './release-files.mjs';

const root = process.cwd();
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8' }).trim();
const provenance = () => ({ sourceRevision: git('rev-parse', 'HEAD'), sourceDirty: git('status', '--porcelain').length > 0 });
const before = provenance();
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
let site;
let basePath;
await build({ plugins: [{
  name: 'nodesim-build-provenance',
  configResolved(config) {
    site = path.resolve(config.root, config.build.outDir);
    basePath = config.base;
  },
}] });
if (JSON.stringify(before) !== JSON.stringify(provenance())) throw new Error('Source revision/dirty state changed during the build; rebuild before packaging.');
const receipt = { schemaVersion: 1, product: 'NodeSim', version, basePath, ...before, files: await inventorySite(site, true) };
await writeFile(path.join(site, BUILD_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(`Recorded ${basePath} build provenance for ${before.sourceRevision}${before.sourceDirty ? ' (dirty local source)' : ''}.`);
