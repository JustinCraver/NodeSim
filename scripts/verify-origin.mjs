import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPath, pathContains, readReleaseArtifact, sha256 } from './release-files.mjs';

const redirects = new Set([301, 302, 303, 307, 308]);
export const requestUrl = (url, headers = {}, timeout = 10_000) => new Promise((resolve, reject) => {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return reject(new Error('TLS verification is disabled in the environment; origin proof is forbidden.'));
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeout) }, (response) => {
    if (url.protocol === 'https:' && !response.socket.authorized) {
      response.destroy(); reject(new Error(`TLS peer was not authorized: ${url}`)); return;
    }
    const tls = url.protocol === 'https:' ? { authorized: true, fingerprint256: response.socket.getPeerCertificate().fingerprint256, protocol: response.socket.getProtocol() } : undefined;
    const chunks = [];
    let bytes = 0;
    response.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 5 * 1024 * 1024) response.destroy(new Error('Origin response exceeded 5 MiB.'));
      else chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks), tls }));
  });
  request.setTimeout(timeout, () => request.destroy(new Error(`Origin request timed out: ${url}`)));
  request.on('error', reject);
  request.end();
});

export const verifyOrigin = async ({ url, artifact, securityHeaders, request = requestUrl, evidence = {} }) => {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.pathname !== '/NodeSim/' || target.search || target.hash || target.username || target.password) throw new Error('Supply an HTTPS origin URL ending exactly in /NodeSim/ without credentials/query/fragment.');
  const { manifest, manifestSha256 } = await readReleaseArtifact(artifact);
  Object.assign(evidence, { schemaVersion: 1, kind: 'real-origin', url: target.href, checkedAt: new Date().toISOString(), version: manifest.version, sourceRevision: manifest.sourceRevision, manifestSha256, requests: [] });
  const deadline = Date.now() + 60_000;
  const get = async (url, headers = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Origin verification exceeded its 60-second deadline.');
    const response = await request(url, headers, Math.min(10_000, remaining));
    evidence.requests.push({ url: url.href, status: response.status, tls: response.tls, headers: response.headers, sha256: sha256(response.body) });
    return response;
  };
  const fetchSecure = async (url, headers = {}) => {
    for (let count = 0; count <= 5; count += 1) {
      if (url.protocol !== 'https:' || url.origin !== target.origin || !url.pathname.startsWith('/NodeSim/')) throw new Error(`Origin redirect escaped the approved HTTPS path: ${url}`);
      const response = await get(url, headers);
      if (response.tls?.authorized !== true) throw new Error(`Missing verified TLS evidence: ${url}`);
      if (!redirects.has(response.status)) return { url, response };
      if (!response.headers.location || count === 5) throw new Error('Invalid or excessive origin redirects.');
      url = new URL(response.headers.location, url);
    }
  };
  const cleartext = new URL(target);
  cleartext.protocol = 'http:';
  const redirect = await get(cleartext);
  if (!redirects.has(redirect.status) || !redirect.headers.location || new URL(redirect.headers.location, cleartext).href !== target.href) throw new Error('HTTP did not redirect to the exact HTTPS project URL.');
  let html;
  for (const file of manifest.files) {
    const resource = file.path === 'index.html' ? target : new URL(file.path.split('/').map(encodeURIComponent).join('/'), target);
    const { url: finalUrl, response } = await fetchSecure(resource);
    if (response.status !== 200 || sha256(response.body) !== file.sha256 || response.body.length !== file.bytes) throw new Error(`Origin status/content does not match ${file.path}.`);
    const mimeTypes = { '.html': ['text/html'], '.js': ['application/javascript', 'text/javascript'], '.css': ['text/css'], '.json': ['application/json'], '.svg': ['image/svg+xml'] };
    const expectedTypes = mimeTypes[path.extname(file.path)];
    const actualType = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (expectedTypes && !expectedTypes.includes(actualType)) throw new Error(`Origin content type is invalid for ${file.path}.`);
    const checkHeaders = (response) => {
      for (const [name, expected] of Object.entries(securityHeaders)) {
        if (response.headers[name.toLowerCase()] !== expected) throw new Error(`Origin header ${name} differs for ${file.path}.`);
      }
    };
    checkHeaders(response);
    const cache = response.headers['cache-control'] ?? '';
    const immutableName = /-[0-9a-f]{8,}\.[A-Za-z0-9]+$/u.test(file.path);
    if (immutableName) {
      if (!/(?:^|,)\s*public(?:,|$)/iu.test(cache) || !/(?:^|,)\s*immutable(?:,|$)/iu.test(cache) || !/max-age=[1-9]\d*/iu.test(cache)) throw new Error(`Hashed asset cache policy missing for ${file.path}.`);
    } else if (!/(?:^|,)\s*no-(?:cache|store)(?:,|$)/iu.test(cache)
      && !(/max-age=0(?:,|$)/iu.test(cache) && /must-revalidate/iu.test(cache))) throw new Error(`Unversioned resource must revalidate or avoid storage: ${file.path}.`);
    const condition = response.headers.etag ? { 'If-None-Match': response.headers.etag }
      : response.headers['last-modified'] ? { 'If-Modified-Since': response.headers['last-modified'] } : {};
    const checked = (await fetchSecure(finalUrl, { ...condition, 'Cache-Control': 'no-cache' })).response;
    checkHeaders(checked);
    if (checked.headers['cache-control'] !== cache) throw new Error(`Cache policy changed on revalidation for ${file.path}.`);
    if (checked.status !== 304 && (checked.status !== 200 || sha256(checked.body) !== file.sha256)) throw new Error(`Cache revalidation returned stale or invalid content for ${file.path}.`);
    if (checked.status === 304 && Object.keys(condition).length === 0) throw new Error(`Unconditional request returned 304 for ${file.path}.`);
    if (file.path === 'index.html') html = response.body.toString('utf8');
  }
  if (!html?.includes('<title>NodeSim</title>')) throw new Error('Origin entrypoint is missing the NodeSim title.');
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gu)) {
    const reference = new URL(match[2], target);
    if (reference.origin !== target.origin || !reference.pathname.startsWith('/NodeSim/')
      || !manifest.files.some((file) => file.path === decodeURIComponent(reference.pathname.slice('/NodeSim/'.length)))) throw new Error(`Origin entrypoint references an unbound asset: ${match[2]}`);
  }
  evidence.status = 'PASS';
  return evidence;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  let outputReserved = false;
  const evidence = { kind: 'real-origin', status: 'FAIL' };
  try {
    const args = new Map();
    for (let index = 2; index < process.argv.length; index += 2) {
      const option = process.argv[index];
      if (!['--url', '--artifact', '--output'].includes(option) || args.has(option)) throw new Error(`Unknown or duplicate option: ${option}`);
      const value = process.argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
      args.set(option, value);
    }
    if (!args.has('--url') || !args.has('--artifact')) throw new Error('Required: --url HTTPS_PROJECT_URL --artifact IMMUTABLE_RELEASE_DIRECTORY');
    const artifact = path.resolve(args.get('--artifact'));
    output = args.get('--output') ? path.resolve(args.get('--output')) : undefined;
    if (output && (pathContains(artifact, output) || pathContains(await canonicalPath(artifact), await canonicalPath(output)))) throw new Error('Evidence output must be outside the immutable artifact.');
    if (output) {
      // Reserve a fresh evidence file before network work. Existing receipts stay intact.
      await writeFile(output, '', { flag: 'wx' });
      outputReserved = true;
    }
    const securityHeaders = JSON.parse(await readFile('deployment/security-headers.json', 'utf8'));
    await verifyOrigin({ url: args.get('--url'), artifact, securityHeaders, evidence });
    console.log(`Real-origin verification passed for ${evidence.url}, manifest ${evidence.manifestSha256}.`);
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error);
    console.error(evidence.failure);
    process.exitCode = 1;
  } finally {
    if (outputReserved) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  }
}
