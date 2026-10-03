import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [url, destination, ...extra] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+\/NodeSim\/$/u.test(url ?? '') || !destination || extra.length) throw new Error('Required: dedicated loopback /NodeSim/ URL and a fresh output directory.');
const output = path.resolve(destination);
await mkdir(output); // Existing evidence and missing parent paths fail before any browser work.
const suites = ['recovery', 'custom-ports', 'numeric-draft', 'authoring'];
const results = [];
try {
  for (const suite of suites) {
    const directory = path.join(output, suite);
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`scripts/${suite}-browser-check.mjs`, url, directory], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    results.push({ suite, ...status });
    if (status.code !== 0) throw new Error(`${suite} browser suite failed; inspect ${directory}.`);
    const receipt = JSON.parse(await readFile(path.join(directory, 'receipt.json'), 'utf8'));
    if ((receipt.status ?? receipt.result) !== 'PASS') throw new Error(`${suite} did not retain a passing receipt.`);
  }
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'PASS', kind: 'local-browser-regression', url, results, manualAccessibility: 'pending human acceptance' }, null, 2));
  console.log('Local browser regressions passed: recovery, custom ports, numeric drafts, and authoring.');
} catch (error) {
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'FAIL', url, results, failure: error.message }, null, 2));
  throw error;
}
