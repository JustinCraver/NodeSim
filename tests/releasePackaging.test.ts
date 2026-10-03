import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/create-release.mjs');
let root: string;
let site: string;
let output: string;
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const packageSite = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });
const receipt = (basePath = '/NodeSim/', version = '1.2.3') => {
  writeFileSync(path.join(site, 'index.html'), `<title>NodeSim</title><script src="${basePath}assets/app.js"></script>`);
  const files = ['assets/app.js', 'index.html'].map((file) => {
    const body = readFileSync(path.join(site, file));
    return { path: file, bytes: body.length, sha256: hash(body) };
  });
  writeFileSync(path.join(site, 'nodesim-build.json'), JSON.stringify({ schemaVersion: 1, product: 'NodeSim', version, basePath, sourceRevision: 'a'.repeat(40), sourceDirty: true, files }));
};
const sentinel = () => {
  const previous = path.join(root, 'artifacts/releases/preceding');
  mkdirSync(previous, { recursive: true });
  writeFileSync(path.join(previous, 'keep'), 'previous artifact');
  return previous;
};
const injected = (copy: string) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { createRelease } from ${JSON.stringify(pathToFileURL(script).href)};
  import { cp, mkdir, writeFile } from 'node:fs/promises';
  try { await createRelease([], { copySite: async (source, target, options) => { ${copy} } }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
`], { cwd: root, encoding: 'utf8', timeout: 10_000 });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nodesim-release-'));
  site = path.join(root, 'dist');
  output = path.join(root, 'artifacts/releases/nodesim-v1.2.3');
  mkdirSync(path.join(site, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  writeFileSync(path.join(site, 'assets/app.js'), 'console.log("fixture");');
  receipt();
});
afterEach(() => {
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('nodesim-release-')) throw new Error('Unexpected release fixture cleanup path');
  rmSync(root, { recursive: true, force: true });
});

describe('immutable release packaging', () => {
  it('records build provenance, verifies hashes, and preserves all bytes on repeat', () => {
    const first = packageSite();
    expect(first.status, first.stderr).toBe(0);
    const manifestBody = readFileSync(path.join(output, 'release-manifest.json'));
    const manifest = JSON.parse(manifestBody.toString());
    expect(manifest).toMatchObject({ basePath: '/NodeSim/', version: '1.2.3', sourceRevision: 'a'.repeat(40), sourceDirty: true });
    const sums = readFileSync(path.join(output, 'SHA256SUMS'), 'utf8');
    expect(sums).toContain(`${hash(manifestBody)}  release-manifest.json`);
    for (const file of manifest.files) expect(hash(readFileSync(path.join(output, 'site', file.path)))).toBe(file.sha256);
    const second = packageSite();
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('Artifact already exists');
    expect(readFileSync(path.join(output, 'release-manifest.json'))).toEqual(manifestBody);
    expect(readFileSync(path.join(output, 'SHA256SUMS'), 'utf8')).toBe(sums);
    for (const file of manifest.files) expect(hash(readFileSync(path.join(output, 'site', file.path)))).toBe(file.sha256);
  });

  it('refuses even an empty destination', () => {
    mkdirSync(output, { recursive: true });
    expect(packageSite().status).toBe(1);
    expect(readdirSync(output)).toEqual([]);
  });

  it('rejects missing input before creating output and preserves preceding artifacts', () => {
    const previous = sentinel();
    const result = packageSite('--site', 'absent');
    expect(result.status).toBe(1);
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(path.join(previous, 'keep'), 'utf8')).toBe('previous artifact');
  });

  it.each(['.', 'dist', 'dist/child', 'artifacts/releases', '../outside'])('rejects unsafe output %s', (destination) => {
    const before = readFileSync(path.join(site, 'index.html'));
    expect(packageSite('--output', destination).status).toBe(1);
    expect(readFileSync(path.join(site, 'index.html'))).toEqual(before);
    expect(existsSync(output)).toBe(false);
  });

  it('rejects input inside the destination', () => {
    const result = packageSite('--site', 'artifacts/releases/new/source', '--output', 'artifacts/releases/new');
    expect(result.stderr).toContain('overlapping');
    expect(existsSync(path.join(root, 'artifacts'))).toBe(false);
  });

  it.each(['CON', 'name.', 'name ', 'a:b'])('rejects nonportable output segment %s before writes', (segment) => {
    const result = packageSite('--output', `artifacts/releases/${segment}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid or nonportable');
    expect(existsSync(path.join(root, 'artifacts'))).toBe(false);
  });

  it.each([['--output'], ['--dirty', 'false'], ['--source-revision', 'b'.repeat(40)], ['--version', '9.0.0'], ['--output', 'a', '--output', 'b']])('rejects invalid arguments %j', (...args) => {
    expect(packageSite(...args).status).toBe(1);
    expect(existsSync(path.join(root, 'artifacts'))).toBe(false);
  });

  it.each(['changed', 'extra', 'missing-receipt'])('rejects %s site provenance', (fault) => {
    if (fault === 'changed') writeFileSync(path.join(site, 'assets/app.js'), 'changed');
    if (fault === 'extra') writeFileSync(path.join(site, 'extra.js'), 'extra');
    if (fault === 'missing-receipt') rmSync(path.join(site, 'nodesim-build.json'));
    expect(packageSite().status).toBe(1);
    expect(existsSync(path.join(root, 'artifacts'))).toBe(false);
  });

  it('rejects nonproduction bases and mismatched versions without writes', () => {
    receipt('/Other/');
    expect(packageSite().stderr).toContain('Release requires /NodeSim/');
    receipt('/NodeSim/', '9.0.0');
    expect(packageSite().stderr).toContain('Build version does not match');
    expect(existsSync(path.join(root, 'artifacts'))).toBe(false);
  });

  it.each(['throw new Error("injected copy failure");', 'await cp(source, target, options); await writeFile(target + "/assets/app.js", "bad copy");'])('cleans staging after copy faults without touching source or earlier artifacts', (copy) => {
    const previous = sentinel();
    const before = readFileSync(path.join(site, 'assets/app.js'));
    expect(injected(copy).status).toBe(1);
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(path.join(site, 'assets/app.js'))).toEqual(before);
    expect(readFileSync(path.join(previous, 'keep'), 'utf8')).toBe('previous artifact');
    expect(readdirSync(path.dirname(output))).toEqual(['preceding']);
  });

  it('preserves a destination created by a competing writer during copying', () => {
    const result = injected('await cp(source, target, options); await mkdir("artifacts/releases/nodesim-v1.2.3");');
    expect(result.status).toBe(1);
    expect(readdirSync(output)).toEqual([]);
    expect(readdirSync(path.dirname(output))).toEqual(['nodesim-v1.2.3']);
  });

  it('rejects output redirected through a directory link', () => {
    const previous = sentinel();
    symlinkSync(previous, path.join(root, 'artifacts/releases/link'), 'junction');
    const result = packageSite('--output', 'artifacts/releases/link/new');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Symbolic link');
    expect(readdirSync(previous)).toEqual(['keep']);
  });
});
