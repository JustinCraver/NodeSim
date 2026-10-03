import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/license-check.mjs');
let root: string;
const check = (metadata: Record<string, unknown>, manifest?: Record<string, unknown>) => {
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/fixture': { version: '1.0.0', ...metadata } } }));
  if (manifest) {
    mkdirSync(path.join(root, 'node_modules/fixture'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules/fixture/package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', ...manifest }));
  }
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 10_000 });
};
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'nodesim-licenses-')); });
afterEach(() => {
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('nodesim-licenses-')) throw new Error('Unexpected license fixture cleanup path');
  rmSync(root, { recursive: true, force: true });
});

describe('offline supported-platform license signal', () => {
  it('reports a known incompatible optional omission separately', () => {
    const result = check({ optional: true, os: [`!${process.platform}`] });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.skipped).toHaveLength(1);
    expect(report.failures).toEqual([]);
    expect(report.rows).toEqual([]);
  });
  it('reports incompatible optional CPUs separately', () => {
    const result = check({ optional: true, cpu: ['unknown-architecture'] });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).skipped).toHaveLength(1);
  });
  it.each([{}, { optional: true }, { optional: true, os: [process.platform] }, { os: [`!${process.platform}`] }])('fails for a required or applicable missing installation: %j', (metadata) => {
    const result = check(metadata);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toHaveLength(1);
    expect(JSON.parse(result.stdout).skipped).toEqual([]);
  });
  it('retains nonallowlisted installed licenses even for optional packages', () => {
    const result = check({ optional: true }, { license: 'CC-BY-4.0' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture@1.0.0: CC-BY-4.0');
  });
  it('fails for unknown licenses and version mismatches', () => {
    const result = check({}, { version: '2.0.0' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('differs from locked');
    expect(result.stderr).toContain('MISSING');
  });
  it('accepts an installed allowlisted license', () => {
    const result = check({}, { license: 'MIT' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).rows[0].license).toBe('MIT');
  });
});
