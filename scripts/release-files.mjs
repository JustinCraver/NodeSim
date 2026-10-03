import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const BUILD_RECEIPT = 'nodesim-build.json';
export const sha256 = (body) => createHash('sha256').update(body).digest('hex');

export const canonicalPath = async (target) => {
  const missing = [];
  let current = path.resolve(target);
  for (;;) {
    try { return path.resolve(await realpath(current), ...missing); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
};

export const pathContains = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export const inventorySite = async (directory, excludeReceipt = false) => {
  const files = [];
  const collect = async (current) => {
    if (!(await lstat(current)).isDirectory()) throw new Error(`Site must be a real directory: ${current}`);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in artifacts: ${absolute}`);
      if (entry.isDirectory()) await collect(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(directory, absolute).replaceAll(path.sep, '/');
        if (excludeReceipt && relative === BUILD_RECEIPT) continue;
        const body = await readFile(absolute);
        files.push({ path: relative, bytes: body.length, sha256: sha256(body) });
      } else throw new Error(`Unsupported artifact entry: ${absolute}`);
    }
  };
  await collect(directory);
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
};

export const readBuildReceipt = async (site) => {
  const receipt = JSON.parse(await readFile(path.join(site, BUILD_RECEIPT), 'utf8'));
  if (receipt.schemaVersion !== 1 || receipt.product !== 'NodeSim'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(receipt.version)
    || !/^\/[A-Za-z0-9/_-]*\/$/u.test(receipt.basePath)
    || !/^[0-9a-f]{40,64}$/u.test(receipt.sourceRevision)
    || typeof receipt.sourceDirty !== 'boolean' || !Array.isArray(receipt.files)) {
    throw new Error('Invalid NodeSim build provenance; rebuild the site with npm run build.');
  }
  const actual = await inventorySite(site, true);
  if (JSON.stringify(actual) !== JSON.stringify(receipt.files)) throw new Error('Site does not match its build provenance (missing, changed, or extra files).');
  const index = await readFile(path.join(site, 'index.html'), 'utf8');
  const references = [...index.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gu)].map((match) => match[2]);
  if (!index.includes('<title>NodeSim</title>') || references.length === 0
    || references.some((reference) => {
      const resolved = new URL(reference, 'https://artifact.invalid');
      return !reference.startsWith(receipt.basePath) || resolved.origin !== 'https://artifact.invalid'
        || !resolved.pathname.startsWith(receipt.basePath)
        || !actual.some((file) => file.path === decodeURIComponent(resolved.pathname.slice(receipt.basePath.length)));
    })) throw new Error('Entrypoint references do not match the build base path and files.');
  return receipt;
};

export const readReleaseArtifact = async (artifact) => {
  const manifestBody = await readFile(path.join(artifact, 'release-manifest.json'));
  const manifest = JSON.parse(manifestBody.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.product !== 'NodeSim' || manifest.basePath !== '/NodeSim/'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
    || manifest.sourceDirty !== false || !/^[0-9a-f]{40,64}$/u.test(manifest.sourceRevision)
    || !Array.isArray(manifest.files) || manifest.files.length > 200) throw new Error('Real-origin proof requires a clean NodeSim release manifest at /NodeSim/.');
  const actual = await inventorySite(path.join(artifact, 'site'));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Artifact files do not match the release manifest.');
  const sums = (await readFile(path.join(artifact, 'SHA256SUMS'), 'utf8')).trim().split(/\r?\n/u);
  const expected = [...manifest.files.map((file) => `${file.sha256}  site/${file.path}`), `${sha256(manifestBody)}  release-manifest.json`];
  if (JSON.stringify(sums) !== JSON.stringify(expected)) throw new Error('SHA256SUMS does not bind every site file and the release manifest. Historical receipts without a manifest hash cannot establish current origin proof.');
  return { manifest, manifestSha256: sha256(manifestBody) };
};
