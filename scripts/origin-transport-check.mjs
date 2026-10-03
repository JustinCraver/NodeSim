import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestUrl } from './verify-origin.mjs';

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = (server) => new Promise((resolve) => {
  server.close(resolve);
  server.closeAllConnections();
});

const childCheck = async (temporary, output) => {
  const fixture = await readFile(path.join(temporary, 'trusted.pem'));
  const trustedKey = await readFile(path.join(temporary, 'trusted-key.pem'));
  const checks = [];
  const body = Buffer.from('native loopback fixture');
  const trusted = httpsServer({ key: trustedKey, cert: fixture }, (request, response) => {
    if (request.url === '/slow') {
      response.writeHead(200);
      const timer = setInterval(() => response.write('x'), 10);
      response.on('close', () => clearInterval(timer));
    } else if (request.url === '/large') {
      response.end(Buffer.alloc(5 * 1024 * 1024 + 1));
    } else {
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end(body);
    }
  });
  const untrusted = httpsServer({ key: await readFile(path.join(temporary, 'untrusted-key.pem')), cert: await readFile(path.join(temporary, 'untrusted.pem')) }, (_request, response) => response.end(body));
  const cleartext = httpServer((_request, response) => response.writeHead(301, { Location: target }).end());
  let target;
  const servers = [trusted, untrusted, cleartext];
  const receipt = { kind: 'native-loopback-transport-fixture', productionAcceptance: false, checks };
  try {
    const trustedPort = await listen(trusted);
    target = `https://127.0.0.1:${trustedPort}/NodeSim/`;
    const badPort = await listen(untrusted);
    const httpPort = await listen(cleartext);
    const redirect = await requestUrl(new URL(`http://127.0.0.1:${httpPort}/NodeSim/`));
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, target);
    checks.push('Native HTTP GET preserves the exact HTTPS redirect location');
    const result = await requestUrl(new URL(redirect.headers.location));
    assert.equal(result.status, 200);
    assert.equal(result.tls.authorized, true);
    assert.ok(result.tls.fingerprint256);
    assert.ok(result.tls.protocol.startsWith('TLS'));
    assert.deepEqual(result.body, body);
    checks.push('Native HTTPS GET verifies the process-local fixture CA and retains TLS/body evidence');
    await assert.rejects(requestUrl(new URL(`https://127.0.0.1:${badPort}/NodeSim/`)), /self.signed|certificate|unable to verify/iu);
    checks.push('An independent untrusted certificate is rejected without disabling TLS checks');
    await assert.rejects(requestUrl(new URL(`https://127.0.0.1:${trustedPort}/large`)), /exceeded 5 MiB/u);
    checks.push('Native streaming responses above 5 MiB are rejected');
    const start = performance.now();
    await assert.rejects(requestUrl(new URL(`https://127.0.0.1:${trustedPort}/slow`), {}, 250), /abort|timed out/iu);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `Continuous streaming bypassed the wall deadline (${elapsed} ms)`);
    checks.push('Continuous streaming cannot bypass the request wall deadline');
    Object.assign(receipt, { status: 'PASS', tls: result.tls, slowRequestDeadlineMs: 250, observedSlowRequestMs: elapsed });
  } catch (error) {
    Object.assign(receipt, { status: 'FAIL', failure: error.message });
    throw error;
  } finally {
    await Promise.all(servers.map(close));
    await writeFile(path.join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  }
};

if (process.argv[2] === '--child') {
  await childCheck(process.argv[3], process.argv[4]);
} else {
  const [destination, option, openssl, ...extra] = process.argv.slice(2);
  if (!destination || option !== '--openssl' || !openssl || extra.length) throw new Error('Required: FRESH_OUTPUT_DIRECTORY --openssl PATH_TO_EXISTING_OPENSSL');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must remain enabled.');
  const output = path.resolve(destination);
  await mkdir(output);
  const temporary = await mkdtemp(path.join(tmpdir(), 'nodesim-native-tls-'));
  try {
    const certificateConfig = path.join(temporary, 'fixture.cnf');
    await writeFile(certificateConfig, '[req]\ndistinguished_name=dn\n[dn]\n', { flag: 'wx' });
    for (const name of ['trusted', 'untrusted']) {
      const result = spawnSync(openssl, ['req', '-config', certificateConfig, '-x509', '-newkey', 'rsa:2048', '-noenc', '-batch', '-days', '1', '-subj', `/CN=NodeSim ${name} disposable fixture`, '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', path.join(temporary, `${name}-key.pem`), '-out', path.join(temporary, `${name}.pem`)], { encoding: 'utf8', timeout: 10_000 });
      if (result.status !== 0) throw new Error(`Disposable certificate generation failed: ${result.error?.message || result.stderr}`);
    }
    // The test CA is trusted only by this disposable child process. No machine
    // trust store or production verifier environment is changed. All servers bind
    // loopback; private fixture keys are removed with the verified temporary root.
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', temporary, output], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(temporary, 'trusted.pem') } });
    if (result.status !== 0) throw new Error(`Native transport check failed: ${result.error?.message || result.stderr}`);
    console.log(`Native loopback transport check passed: ${path.join(output, 'receipt.json')}`);
  } catch (error) {
    try {
      await writeFile(path.join(output, 'receipt.json'), `${JSON.stringify({ kind: 'native-loopback-transport-fixture', status: 'FAIL', productionAcceptance: false, failure: error.message }, null, 2)}\n`, { flag: 'wx' });
    } catch (receiptError) { if (receiptError.code !== 'EEXIST') throw receiptError; }
    throw error;
  } finally {
    if (path.dirname(temporary) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith('nodesim-native-tls-')) throw new Error('Unexpected native TLS fixture cleanup path');
    await rm(temporary, { recursive: true, force: true });
  }
}
