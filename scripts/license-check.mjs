import { readFile } from 'node:fs/promises';
import path from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const allowed = /^(?:0BSD|Apache-2\.0|BSD(?:-2-Clause|-3-Clause)?|BlueOak-1\.0\.0|CC0-1\.0|ISC|MIT|Python-2\.0|Unlicense)(?: OR (?:Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|MIT))*$/u;
const failures = [];
const rows = [];

for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || !metadata.version || !location.includes('node_modules/')) continue;
  try {
    const manifest = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
    const license = typeof manifest.license === 'string' ? manifest.license : 'MISSING';
    rows.push({ name: manifest.name, version: metadata.version, license });
    if (!allowed.test(license)) failures.push(`${manifest.name}@${metadata.version}: ${license}`);
  } catch {
    failures.push(`${location}@${metadata.version}: manifest unavailable`);
  }
}

console.log(JSON.stringify(rows.sort((left, right) => left.name.localeCompare(right.name)), null, 2));
if (failures.length > 0) {
  console.error(`License review required:\n${failures.join('\n')}`);
  process.exitCode = 1;
}
