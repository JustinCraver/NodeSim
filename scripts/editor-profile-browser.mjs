import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const url = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+\/NodeSim\/$/u.test(url ?? '')) throw new Error('Supply a dedicated loopback development /NodeSim/ URL.');
const output = path.resolve(process.argv[3] || 'artifacts/editor-profile');
const optimized = process.argv[4] === '--expect-optimized';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => { window.__nodesimProfile = { stores: 0, computations: 0, projections: 0 }; });
// Instrument only this isolated browser's dev-module responses; product files
// and production bundles do not contain profiling globals or counters.
for (const [module, needle, replacement] of [
  ['document/documentStore.ts', 'constructor(initialDocument) {', 'constructor(initialDocument) { window.__nodesimProfile.stores += 1;'],
  ['engine/computeGraph.ts', 'const horizon = settings.horizonMonths;', 'window.__nodesimProfile.computations += 1; const horizon = settings.horizonMonths;'],
  ['graph/createCytoscape.ts', 'const lifecycle = new ControllerLifecycle(cy);', 'window.__nodesimProfile.cy = cy; const lifecycle = new ControllerLifecycle(cy);'],
]) {
  await page.route(`**/src/${module}*`, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    assert.ok(body.includes(needle), `Profiling instrumentation changed: ${module}`);
    await route.fulfill({ response, body: body.replace(needle, replacement) });
  });
}
const settled = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const activate = async (locator) => { await locator.focus(); await locator.press('Enter'); await settled(); };
const metrics = () => page.evaluate(() => {
  const p = window.__nodesimProfile;
  return { stores: p.stores, computations: p.computations, zoom: p.cy.zoom(), pan: p.cy.pan(), sameElement: p.node ? p.cy.getElementById('shared') === p.node : true };
});
const exported = async () => {
  const download = page.waitForEvent('download');
  await page.keyboard.press('Alt+s');
  const chunks = [];
  for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
try {
  await page.goto(url);
  const document = JSON.parse(await readFile('tests/fixtures/nested-two-level.v1.json', 'utf8'));
  for (let index = 0; index < 150; index += 1) {
    const id = `chain_${index}`;
    document.graph.nodes.push({ id, label: `Chain ${index}`, kind: 'value', baseValue: 0, position: { x: (index % 15) * 290, y: 400 + Math.floor(index / 15) * 150 } });
    document.graph.edges.push({ id: `edge_${index}`, source: index === 0 ? 'result' : `chain_${index - 1}`, target: id, kind: 'flow', weight: 1, lagMonths: 0 });
  }
  await page.getByLabel('Open', { exact: true }).setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await page.getByRole('treeitem', { name: /Chain 149 Value/ }).waitFor();
  await activate(page.getByRole('button', { name: 'Focus canvas', exact: true }));
  const before = await metrics();
  const selectionMs = [];
  for (let index = 0; index < 10; index += 1) {
    const start = await page.evaluate(() => performance.now());
    await activate(page.getByRole('treeitem', { name: index % 2 ? /Root result Value/ : /Root input Value/ }).first());
    selectionMs.push((await page.evaluate(() => performance.now())) - start);
  }
  await activate(page.getByRole('treeitem', { name: /Root input Value/ }).first());
  const baseline = await exported();
  await page.evaluate(() => {
    const p = window.__nodesimProfile;
    p.cy.zoom(0.8); p.cy.pan({ x: 77, y: 88 }); p.node = p.cy.getElementById('shared');
  });
  const editingBefore = await metrics();
  const editMs = [];
  for (let index = 0; index < 10; index += 1) {
    const start = await page.evaluate(() => performance.now());
    const input = page.getByLabel('Value', { exact: true });
    await input.fill(String(6 + index));
    await input.press('Enter');
    await settled();
    await page.getByRole('treeitem', { name: new RegExp(`Root result Value, value ${2 * (6 + index)}(?: |$)`) }).waitFor();
    editMs.push((await page.evaluate(() => performance.now())) - start);
    await page.keyboard.press('Alt+u');
    await settled();
  }
  const after = await metrics();
  assert.deepEqual(await exported(), baseline);
  assert.deepEqual(errors, []);
  if (optimized) {
    assert.equal(after.stores, before.stores, 'Selection/field edits constructed unused stores');
    assert.equal(after.sameElement, true, 'An unchanged node was recreated');
    assert.equal(after.zoom, editingBefore.zoom, 'Field/history edits changed zoom');
    assert.deepEqual(after.pan, editingBefore.pan, 'Field/history edits changed pan');
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  await page.screenshot({ path: path.join(output, 'profile.png'), fullPage: true });
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'PASS', optimized, url, browser: browser.version(), nodes: document.graph.nodes.length, before, editingBefore, after, selectionMs, editMs, medianSelectionMs: median(selectionMs), medianEditMs: median(editMs), errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'FAIL', optimized, url, errors, failure: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
