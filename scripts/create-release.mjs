import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventorySite, readBuildReceipt, sha256 } from './release-files.mjs';

const exists = async (target) => {
  try { await lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const within = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const rejectLinks = async (target) => {
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (await exists(current) && (await lstat(current)).isSymbolicLink()) throw new Error(`Symbolic link in artifact path: ${current}`);
  }
};

export const createRelease = async (argv, { root = process.cwd(), copySite = cp } = {}) => {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    if (!['--site', '--output'].includes(option)) throw new Error(`Unknown option: ${option}. Version, base, revision, and dirty state come from the build receipt; historical overrides are unsupported.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    if (args.has(option)) throw new Error(`Duplicate option: ${option}`);
    args.set(option, value);
  }
  root = path.resolve(root);
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw new Error(`Invalid release version: ${version}`);
  const input = path.resolve(root, args.get('--site') ?? 'dist');
  const releases = path.join(root, 'artifacts', 'releases');
  const output = path.resolve(root, args.get('--output') ?? path.join(releases, `nodesim-v${version}`));
  const invalidSegment = (segment) => /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[ .]$/u.test(segment)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment);
  if ([input, output].some((target) => target.slice(path.parse(target).root.length).split(path.sep).some(invalidSegment))) throw new Error('Invalid or nonportable artifact path.');
  if (output === releases || !within(releases, output)) throw new Error('Output must be a new directory strictly inside artifacts/releases.');
  if (!within(root, input) || input === root || within(input, output) || within(output, input)) throw new Error('Unsafe or overlapping source/output paths.');
  await rejectLinks(input);
  await rejectLinks(output);
  if (await exists(output)) throw new Error(`Artifact already exists: ${output}`);
  const receipt = await readBuildReceipt(input);
  if (receipt.version !== version) throw new Error('Build version does not match package.json; rebuild before packaging.');
  if (receipt.basePath !== '/NodeSim/') throw new Error(`Release requires /NodeSim/, build used ${receipt.basePath}.`);
  const files = await inventorySite(input);
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(path.join(parent, '.nodesim-stage-'));
  let claimedOutput = false;
  try {
    const stagedSite = path.join(stage, 'site');
    await copySite(input, stagedSite, { recursive: true, errorOnExist: true, force: false, dereference: false });
    if (JSON.stringify(await inventorySite(stagedSite)) !== JSON.stringify(files)
      || JSON.stringify(await inventorySite(input)) !== JSON.stringify(files)) throw new Error('Copy verification failed or source changed during packaging.');
    const manifest = {
      schemaVersion: 1, product: 'NodeSim', version, basePath: receipt.basePath,
      sourceRevision: receipt.sourceRevision, sourceDirty: receipt.sourceDirty,
      provenance: { kind: 'build-receipt', path: 'site/nodesim-build.json' }, files,
    };
    const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(path.join(stage, 'release-manifest.json'), manifestBody, { flag: 'wx' });
    await writeFile(path.join(stage, 'SHA256SUMS'), `${files.map((file) => `${file.sha256}  site/${file.path}`).join('\n')}\n${sha256(manifestBody)}  release-manifest.json\n`, { flag: 'wx' });
    // Exclusive creation protects even an empty destination from competing packagers.
    // Every source/copy/hash check precedes this reservation; the manifest is last.
    await mkdir(output);
    claimedOutput = true;
    await rename(stagedSite, path.join(output, 'site'));
    await rename(path.join(stage, 'SHA256SUMS'), path.join(output, 'SHA256SUMS'));
    await rename(path.join(stage, 'release-manifest.json'), path.join(output, 'release-manifest.json'));
    return { output, manifest };
  } catch (error) {
    if (claimedOutput) await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    if (path.dirname(stage) !== parent || !path.basename(stage).startsWith('.nodesim-stage-')) throw new Error('Unexpected staging cleanup path');
    await rm(stage, { recursive: true, force: true });
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { output, manifest } = await createRelease(process.argv.slice(2));
    console.log(`Created immutable NodeSim v${manifest.version} artifact with ${manifest.files.length} files at ${path.relative(process.cwd(), output)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
