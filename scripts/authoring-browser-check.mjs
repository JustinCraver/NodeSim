import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const url = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+\/NodeSim\/$/u.test(url ?? '')) throw new Error('Supply a dedicated loopback /NodeSim/ URL.');
const output = path.resolve(process.argv[3] || 'artifacts/authoring-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
let activePage;
let lastDownload = 0;
const activate = async (locator) => { await locator.focus(); await locator.press('Enter'); };
const settled = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const exported = async (page) => {
  const gap = 250 - (Date.now() - lastDownload);
  if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Alt+s');
  const chunks = [];
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk);
  lastDownload = Date.now();
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const show = async (page, name) => {
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.count()) await activate(tab);
};
const selectOption = async (locator, value) => {
  await locator.waitFor({ state: 'visible' });
  const index = await locator.locator('option').evaluateAll((options, value) => options.findIndex((option) => option.value === value), value);
  assert.ok(index >= 0, `Missing option ${value}: ${await locator.locator('option').evaluateAll((options) => options.map((option) => option.value))}`);
  await locator.focus(); await locator.press('Home');
  for (let step = 0; step < index; step += 1) await locator.press('ArrowDown');
  await locator.press('Enter'); await locator.press('Tab');
};
try {
  for (const [mode, viewport] of [['desktop', { width: 1440, height: 1000 }], ['compact', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.getByLabel('Horizon (months)', { exact: true }).waitFor();
    const baseline = await exported(page);
    await page.keyboard.press('Alt+a');
    await activate(page.getByRole('menuitem', { name: 'Value', exact: true }));
    await show(page, 'Inspector');
    const label = page.getByLabel('Label', { exact: true });
    await label.fill('Browser Value'); await label.press('Tab'); await settled(page);
    const value = page.getByLabel('Value', { exact: true });
    await value.fill('12.5'); await value.press('Enter'); await settled(page);
    const added = await exported(page);
    assert.equal(added.graph.nodes.length, baseline.graph.nodes.length + 1);
    const created = added.graph.nodes.find((node) => node.label === 'Browser Value');
    assert.equal(created.baseValue, 12.5);
    await show(page, 'Graph');
    await page.keyboard.press('Alt+c');
    await selectOption(page.getByLabel('From', { exact: true }), created.id);
    await selectOption(page.getByLabel('To', { exact: true }), created.id);
    await activate(page.getByRole('button', { name: 'Create connection', exact: true }));
    assert.ok((await page.locator('#connect-error').innerText()).includes('different nodes'));
    assert.deepEqual(await exported(page), added);
    await selectOption(page.getByLabel('From', { exact: true }), 'netIncome');
    await selectOption(page.getByLabel('To', { exact: true }), created.id);
    await activate(page.getByRole('button', { name: 'Create connection', exact: true }));
    assert.ok((await page.locator('#connect-error').innerText()).includes('Value nodes require scalar'));
    assert.deepEqual(await exported(page), added);
    await selectOption(page.getByLabel('From', { exact: true }), created.id);
    await selectOption(page.getByLabel('To', { exact: true }), 'monthlySavings');
    await activate(page.getByRole('button', { name: 'Create connection', exact: true }));
    const connected = await exported(page);
    assert.equal(connected.graph.edges.length, baseline.graph.edges.length + 1);
    await page.keyboard.press('Alt+u'); await settled(page);
    assert.deepEqual(await exported(page), added);
    await page.keyboard.press('Alt+r'); await settled(page);
    assert.deepEqual(await exported(page), connected);
    checks.push(`${mode}: keyboard add/fields, rejected/accepted connections, exact history exports`);

    await show(page, 'Graph structure');
    await activate(page.getByRole('treeitem', { name: /Adjusted Formula/ }).first());
    await settled(page);
    const formula = page.getByLabel('Formula', { exact: true });
    await formula.fill('customInput * 0.8'); await formula.press('Tab'); await settled(page);
    const nestedEdit = await exported(page);
    assert.equal(nestedEdit.graph.nodes.find((node) => node.id === 'savingsAdjuster').custom.internalGraph.nodes.find((node) => node.id === 'customOutput').formula, 'customInput * 0.8');
    assert.equal(nestedEdit.graph.nodes.length, connected.graph.nodes.length);
    await page.keyboard.press('Alt+u'); await settled(page);
    assert.deepEqual(await exported(page), connected);
    await show(page, 'Graph');
    await page.getByLabel('Open', { exact: true }).setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(nestedEdit)) });
    await settled(page);
    assert.deepEqual(await exported(page), nestedEdit);
    // Wait for this accepted root revision to reach the actual autosave envelope.
    await page.waitForFunction((expected) => {
      const envelope = JSON.parse(localStorage.getItem('nodesim.document.v1.current') || 'null');
      return envelope && JSON.parse(envelope.payload).graph.nodes.some((node) => node.id === 'savingsAdjuster' && node.custom.internalGraph.nodes.some((inner) => inner.formula === expected));
    }, 'customInput * 0.8');
    await page.reload(); await page.getByLabel('Horizon (months)', { exact: true }).waitFor();
    assert.deepEqual(await exported(page), nestedEdit);
    checks.push(`${mode}: nested edits, root file round trip, persisted reload`);
    await page.setViewportSize(mode === 'desktop' ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await settled(page);
    await page.setViewportSize(viewport); await settled(page);
    assert.deepEqual(await exported(page), nestedEdit);
    await show(page, 'Graph structure');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    await page.screenshot({ path: path.join(output, `${mode}-after-remount.png`), fullPage: true });
    checks.push(`${mode}: desktop/compact remount with exact root preservation`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'PASS', url, browser: browser.version(), checks, errors, manualScreenReader: 'pending human acceptance', osPicker: 'pending human acceptance', compactReadability: 'pending real-user assessment' }, null, 2));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'FAIL', url, checks, errors, failure: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
