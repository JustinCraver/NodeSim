import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const allowed = /^(?:0BSD|Apache-2\.0|BSD(?:-2-Clause|-3-Clause)?|BlueOak-1\.0\.0|CC0-1\.0|ISC|MIT|Python-2\.0|Unlicense)(?: OR (?:Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|MIT))*$/u;
const supports = (restrictions, current) => {
  if (!Array.isArray(restrictions) || restrictions.length === 0) return true;
  if (restrictions.includes(`!${current}`) || restrictions.includes('!any')) return false;
  const positive = restrictions.filter((item) => !item.startsWith('!'));
  return positive.length === 0 || positive.includes('any') || positive.includes(current);
};

export const checkLicenses = async (lock, { root = process.cwd(), platform = process.platform, arch = process.arch } = {}) => {
  const failures = [];
  const rows = [];
  const skipped = [];
  for (const [location, metadata] of Object.entries(lock.packages)) {
    if (!location || !metadata.version || !location.includes('node_modules/')) continue;
    const absolute = path.resolve(root, location, 'package.json');
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Lockfile path escapes the installation: ${location}`);
    try {
      const manifest = JSON.parse(await readFile(absolute, 'utf8'));
      const license = typeof manifest.license === 'string' ? manifest.license : 'MISSING';
      rows.push({ name: manifest.name || location, version: metadata.version, license });
      if (manifest.version !== metadata.version) failures.push(`${location}: installed version ${manifest.version} differs from locked ${metadata.version}`);
      if (!allowed.test(license)) failures.push(`${manifest.name || location}@${metadata.version}: ${license}`);
    } catch (error) {
      const incompatible = !supports(metadata.os, platform) || !supports(metadata.cpu, arch);
      if (error.code === 'ENOENT' && metadata.optional === true && incompatible) {
        skipped.push({ location, version: metadata.version, reason: `optional package incompatible with ${platform}/${arch}`, os: metadata.os, cpu: metadata.cpu });
      } else failures.push(`${location}@${metadata.version}: manifest unavailable (${error.code || 'invalid JSON'})`);
    }
  }
  return { platform, arch, rows: rows.sort((left, right) => left.name.localeCompare(right.name)), skipped, failures };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error('The offline license command accepts no platform or policy overrides.');
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
    const result = await checkLicenses(lock);
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length > 0) {
      console.error(`License review required:\n${result.failures.join('\n')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
