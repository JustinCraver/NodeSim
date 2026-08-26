import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index].startsWith('--')) args.set(process.argv[index].slice(2), process.argv[index + 1]), index += 1;
}
const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = args.get('version') ?? packageJson.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw new Error(`Invalid release version: ${version}`);
const input = path.resolve(root, args.get('site') ?? 'dist');
const releaseRoot = path.resolve(root, args.get('output') ?? path.join('artifacts', 'releases', `nodesim-v${version}`));
const site = path.join(releaseRoot, 'site');
const sourceRevision = args.get('source-revision') ?? execFileSync(
  'git',
  ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'],
  { cwd: root, encoding: 'utf8' },
).trim();
const sourceDirty = args.has('dirty')
  ? args.get('dirty') === 'true'
  : execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;

if (input !== site) {
  await rm(releaseRoot, { recursive: true, force: true });
  await mkdir(releaseRoot, { recursive: true });
  await cp(input, site, { recursive: true });
}

const collectFiles = async (directory) => {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(absolute));
    else result.push(absolute);
  }
  return result;
};

const files = [];
for (const file of (await collectFiles(site)).sort()) {
  const body = await readFile(file);
  files.push({
    path: path.relative(site, file).replaceAll(path.sep, '/'),
    bytes: (await stat(file)).size,
    sha256: createHash('sha256').update(body).digest('hex'),
  });
}
const manifest = {
  schemaVersion: 1,
  product: 'NodeSim',
  version,
  basePath: '/NodeSim/',
  sourceRevision,
  sourceDirty,
  files,
};
await writeFile(path.join(releaseRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(releaseRoot, 'SHA256SUMS'), `${files.map((file) => `${file.sha256}  site/${file.path}`).join('\n')}\n`);
console.log(`Created NodeSim v${version} artifact with ${files.length} files at ${path.relative(root, releaseRoot)}.`);
