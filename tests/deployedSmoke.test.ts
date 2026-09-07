import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let site: string;

const writeIndex = (reference = '/NodeSim/assets/app.js', title = 'NodeSim', quote = '"') =>
  writeFileSync(path.join(site, 'index.html'), `<title>${title}</title><script src=${quote}${reference}${quote}></script>`);

const smoke = (...args: string[]) => spawnSync(
  process.execPath,
  ['scripts/deployed-smoke.mjs', '--site', site, ...args],
  { encoding: 'utf8', timeout: 10_000 },
);

beforeEach(() => {
  site = mkdtempSync(path.join(tmpdir(), 'nodesim-smoke-'));
  mkdirSync(path.join(site, 'assets'));
  writeFileSync(path.join(site, 'assets', 'app.js'), 'console.log("fixture");');
  writeIndex();
});

afterEach(() => {
  // Only remove the temporary fixture created by this test.
  if (path.dirname(site) !== path.resolve(tmpdir()) || !path.basename(site).startsWith('nodesim-smoke-')) {
    throw new Error('Unexpected smoke fixture path');
  }
  rmSync(site, { recursive: true, force: true });
});

describe('local deployed-path smoke command', () => {
  it('serves a valid project artifact with the header contract', () => {
    const result = smoke();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Deployed-path smoke passed');
  });

  it.each(['"', "'"])('rejects a missing asset referenced with %s quotes', (quote) => {
    writeIndex('/NodeSim/assets/missing.js', 'NodeSim', quote);
    const result = smoke();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing.js returned 404');
  });

  it.each(['/assets/app.js', '/NodeSim/../outside.js'])(
    'rejects a reference that escapes the project path: %s',
    (reference) => {
      writeIndex(reference);
      const result = smoke();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Assets escaped /NodeSim/');
    },
  );

  it('rejects a wrong product title', () => {
    writeIndex('/NodeSim/assets/app.js', 'Wrong product');
    const result = smoke();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Expected NodeSim title');
  });

  it('rejects an unsupported origin option instead of silently testing localhost', () => {
    const result = smoke('--url', 'https://example.invalid/NodeSim/');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown option: --url');
  });

  it('rejects an option without a value', () => {
    const result = smoke('--title');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing value for --title');
  });
});
