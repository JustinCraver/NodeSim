import { readFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const root = lock.packages[''];
const direct = new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})]);
const majors = new Map();

for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || !metadata.version || !location.includes('node_modules/')) continue;
  const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length).split('/').slice(0, location.includes('node_modules/@') ? 2 : 1).join('/');
  const major = metadata.version.split('.')[0];
  if (!majors.has(name)) majors.set(name, new Map());
  const versions = majors.get(name);
  if (!versions.has(major)) versions.set(major, new Set());
  versions.get(major).add(metadata.version);
}

const duplicates = [...majors.entries()].filter(([, versions]) => versions.size > 1).sort(([left], [right]) => left.localeCompare(right));
const directDuplicates = duplicates.filter(([name]) => direct.has(name));
for (const [name, versions] of duplicates) {
  const rendered = [...versions].map(([major, values]) => `${major}.x (${[...values].join(', ')})`).join('; ');
  console.log(`${direct.has(name) ? 'FAIL direct' : 'NOTICE transitive'} ${name}: ${rendered}`);
}
if (directDuplicates.length > 0) {
  console.error('Direct dependencies must not introduce a second major beside their transitive copy.');
  process.exitCode = 1;
} else {
  console.log('Dependency-major gate passed: no direct dependency duplicates another installed major.');
}
