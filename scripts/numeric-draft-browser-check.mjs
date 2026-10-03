import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const url = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+\/NodeSim\/$/u.test(url ?? '')) throw new Error('Supply a dedicated loopback /NodeSim/ URL.');
const output = path.resolve(process.argv[3] || 'artifacts/numeric-drafts-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
let activePage;
const activate = async (locator) => { await locator.focus(); await locator.press('Enter'); };
const inspect = async (page, name) => {
  const tab = page.getByRole('tab', { name: 'Graph structure', exact: true });
  if (await tab.count()) await activate(tab);
  await activate(page.getByRole('treeitem', { name }).first());
};
const assertRejected = async (field, draft) => {
  await field.page().evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await field.inputValue(), draft);
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  const id = await field.getAttribute('aria-describedby');
  assert.ok(id);
  assert.ok(await field.page().locator(`[id="${id}"]`).innerText());
};
try {
  for (const [mode, viewport] of [['desktop', { width: 1440, height: 1000 }], ['compact', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await inspect(page, /Net Income Income/);
    let field = page.getByRole('textbox', { name: /^Base value/ });
    await field.fill('-');
    await field.press('Tab');
    await assertRejected(field, '-');
    await page.screenshot({ path: path.join(output, `${mode}-rejected.png`), fullPage: true });
    await field.focus();
    await field.press('Escape');
    assert.equal(await field.inputValue(), '4000');
    assert.equal(await field.getAttribute('aria-invalid'), null);
    await field.fill('4100');
    await field.press('Enter');
    await page.locator('.semantic-tree-item').filter({ hasText: /Monthly Savings/ }).filter({ hasText: /1600/ }).waitFor({ state: 'attached' });
    await page.keyboard.press('Alt+u');
    await page.waitForFunction((id) => document.getElementById(id)?.value === '4000', await field.getAttribute('id'));
    assert.equal(await field.inputValue(), '4000');
    await field.fill('-');
    await field.press('Enter');
    await assertRejected(field, '-');
    await page.keyboard.press('Alt+r');
    await page.waitForFunction((id) => document.getElementById(id)?.value === '4100', await field.getAttribute('id'));
    assert.equal(await field.inputValue(), '4100');
    assert.equal(await field.getAttribute('aria-invalid'), null);
    await field.fill('-');
    await field.press('Tab');
    await inspect(page, /Fixed Expenses Expense/);
    field = page.getByRole('textbox', { name: /^Base value/ });
    assert.equal(await field.inputValue(), '2500');
    assert.equal(await field.getAttribute('aria-invalid'), null);
    // A finite negative expense passes generic number parsing but is rejected by
    // the document command. Its text/error must remain associated with the field.
    await field.fill('-1');
    await field.press('Enter');
    await assertRejected(field, '-1');
    await field.press('Escape');
    assert.equal(await field.inputValue(), '2500');
    assert.equal(await field.getAttribute('aria-invalid'), null);
    checks.push(`${mode}: rejected blur/Enter, cancellation, parent rejection, external history, and selection reset`);
    if (mode === 'compact') await activate(page.getByRole('tab', { name: 'Graph', exact: true }));
    const horizon = page.getByLabel('Horizon (months)', { exact: true });
    await horizon.fill('0');
    await horizon.press('Tab');
    await assertRejected(horizon, '0');
    await horizon.focus();
    await horizon.press('Escape');
    assert.equal(await horizon.inputValue(), '120');
    await horizon.fill('60');
    await horizon.press('Enter');
    await page.keyboard.press('Alt+u');
    await page.waitForFunction(() => document.querySelector('[data-numeric-draft]')?.value === '120');
    assert.equal(await horizon.inputValue(), '120');
    assert.equal(await horizon.getAttribute('aria-invalid'), null);
    checks.push(`${mode}: shared horizon draft/commit/history contract`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'PASS', url, browser: browser.version(), checks, errors }, null, 2));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'FAIL', url, checks, errors, failure: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
