import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/verify-origin.mjs');
const headers = JSON.parse(readFileSync('deployment/security-headers.json', 'utf8'));
let root: string;
const hash = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const artifact = (dirty = false, reference = '/NodeSim/assets/app-aaaaaaaa.js') => {
  const entries = [
    { path: 'assets/app-aaaaaaaa.js', body: 'console.log("fixture");' },
    { path: 'index.html', body: `<title>NodeSim</title><script src="${reference}"></script>` },
  ];
  const files = entries.map(({ path: relative, body }) => {
    writeFileSync(path.join(root, 'site', relative), body);
    return { path: relative, bytes: Buffer.byteLength(body), sha256: hash(body) };
  });
  const body = JSON.stringify({ schemaVersion: 1, product: 'NodeSim', version: '1.2.3', basePath: '/NodeSim/', sourceRevision: 'a'.repeat(40), sourceDirty: dirty, files });
  writeFileSync(path.join(root, 'release-manifest.json'), body);
  writeFileSync(path.join(root, 'SHA256SUMS'), `${files.map((file) => `${file.sha256}  site/${file.path}`).join('\n')}\n${hash(body)}  release-manifest.json\n`);
};
const check = (fault = '') => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { verifyOrigin } from ${JSON.stringify(pathToFileURL(script).href)};
  import { readFile } from 'node:fs/promises';
  const fault = ${JSON.stringify(fault)};
  const securityHeaders = ${JSON.stringify(headers)};
  const lower = Object.fromEntries(Object.entries(securityHeaders).map(([name, value]) => [name.toLowerCase(), value]));
  const evidence = {};
  const request = async (url, condition) => {
    if (url.protocol === 'http:') return { status: fault === 'http' ? 200 : 301, headers: { location: 'https://fixture.invalid/NodeSim/' }, body: Buffer.alloc(0) };
    if (fault === 'redirect') return { status: 302, headers: { location: 'http://fixture.invalid/NodeSim/' }, body: Buffer.alloc(0), tls: { authorized: true } };
    const relative = url.pathname === '/NodeSim/' ? 'index.html' : url.pathname.slice('/NodeSim/'.length);
    let body = await readFile('site/' + relative);
    const responseHeaders = { ...lower, etag: '"fixture"', 'content-type': relative === 'index.html' ? 'text/html' : 'text/javascript', 'cache-control': relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' };
    if (fault === 'mime') responseHeaders['content-type'] = 'text/plain';
    if (fault === 'header') delete responseHeaders['x-frame-options'];
    if (fault === 'cache') responseHeaders['cache-control'] = 'public, max-age=31536000, immutable';
    if (fault === 'asset' && relative.endsWith('.js')) body = Buffer.from('changed');
    if (fault === 'revalidation' && condition['If-None-Match']) body = Buffer.from('stale');
    if (fault === '304' && condition['If-None-Match']) return { status: 304, headers: responseHeaders, body: Buffer.alloc(0), tls: { authorized: true } };
    return { status: 200, headers: responseHeaders, body, tls: { authorized: fault !== 'tls', fingerprint256: 'mock-test-only' } };
  };
  try { await verifyOrigin({ url: 'https://fixture.invalid/NodeSim/', artifact: '.', securityHeaders, request, evidence }); console.log(JSON.stringify(evidence)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
`], { cwd: root, encoding: 'utf8', timeout: 10_000 });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nodesim-origin-'));
  mkdirSync(path.join(root, 'site/assets'), { recursive: true });
  mkdirSync(path.join(root, 'deployment'));
  writeFileSync(path.join(root, 'deployment/security-headers.json'), JSON.stringify(headers));
  artifact();
});
afterEach(() => {
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('nodesim-origin-')) throw new Error('Unexpected origin fixture cleanup path');
  rmSync(root, { recursive: true, force: true });
});

describe('read-only real-origin verifier (mock transport, not deployment acceptance)', () => {
  it.each(['', '304'])('binds origin content, redirects, headers, cache checks, and hashes: %s', (fault) => {
    const result = check(fault);
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.kind).toBe('real-origin');
    expect(receipt.status).toBe('PASS');
    expect(receipt.manifestSha256).toBe(hash(readFileSync(path.join(root, 'release-manifest.json'))));
    expect(receipt.requests).toHaveLength(5);
  });
  it.each(['http', 'redirect', 'header', 'cache', 'asset', 'revalidation', 'tls', 'mime'])('rejects origin fault %s', (fault) => {
    expect(check(fault).status).toBe(1);
  });
  it('rejects dirty source and altered local artifacts before network checks', () => {
    artifact(true);
    expect(check().stderr).toContain('clean NodeSim');
    artifact();
    writeFileSync(path.join(root, 'site/assets/app-aaaaaaaa.js'), 'altered');
    expect(check().stderr).toContain('files do not match');
  });
  it('rejects a manifest not bound by SHA256SUMS', () => {
    writeFileSync(path.join(root, 'SHA256SUMS'), 'historical list');
    expect(check().stderr).toContain('does not bind');
  });
  it('rejects escaped entrypoint references even when local hashes agree', () => {
    artifact(false, '/outside.js');
    expect(check().stderr).toContain('unbound asset');
  });
  it('refuses to overwrite existing evidence or write inside the artifact', () => {
    const output = path.join(root, 'existing.json');
    writeFileSync(output, 'preserved evidence');
    const result = spawnSync(process.execPath, [script, '--url', 'https://fixture.invalid/NodeSim/', '--artifact', root, '--output', output], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(readFileSync(output, 'utf8')).toBe('preserved evidence');
    expect(readFileSync(path.join(root, 'release-manifest.json'), 'utf8')).toContain('NodeSim');
    const retained = path.join(root, 'release');
    mkdirSync(retained);
    for (const entry of ['site', 'release-manifest.json', 'SHA256SUMS']) cpSync(path.join(root, entry), path.join(retained, entry), { recursive: true });
    const existing = spawnSync(process.execPath, [script, '--url', 'https://fixture.invalid/NodeSim/', '--artifact', retained, '--output', output], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    expect(existing.status).toBe(1);
    expect(existing.stderr).toContain('EEXIST');
    expect(readFileSync(output, 'utf8')).toBe('preserved evidence');
  });
  it('rejects disabled TLS verification without issuing a request', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { requestUrl } from ${JSON.stringify(pathToFileURL(script).href)};
      try { await requestUrl(new URL('https://fixture.invalid/NodeSim/')); }
      catch (error) { console.error(error.message); process.exitCode = 1; }
    `], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TLS verification is disabled');
  });
  it('rejects evidence paths redirected into the artifact through a link', () => {
    const retained = path.join(root, 'release');
    mkdirSync(retained);
    for (const entry of ['site', 'release-manifest.json', 'SHA256SUMS']) cpSync(path.join(root, entry), path.join(retained, entry), { recursive: true });
    const alias = path.join(root, 'alias');
    symlinkSync(retained, alias, 'junction');
    const output = path.join(alias, 'forbidden.json');
    const result = spawnSync(process.execPath, [script, '--url', 'https://fixture.invalid/NodeSim/', '--artifact', retained, '--output', output], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('outside the immutable artifact');
    expect(existsSync(output)).toBe(false);
  });
});
