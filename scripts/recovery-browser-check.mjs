// Optional rendered R1 verification. Uses an externally supplied Playwright
// module; it does not install dependencies or touch an existing browser profile.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const url = process.argv[2];
if (!url || !/^http:\/\/127\.0\.0\.1:\d+\/NodeSim\/$/u.test(url)) {
  throw new Error('Supply a dedicated loopback URL, e.g. http://127.0.0.1:5197/NodeSim/');
}
const output = path.resolve(process.argv[3] || 'artifacts/recovery-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
const current = 'nodesim.document.v1.current';
const temporary = 'nodesim.document.v1.temporary';
const horizon = (page) => page.getByLabel('Horizon (months)', { exact: true });
const newContext = async (seed = {}, mode = '') => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(({ seed, mode }) => {
    if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
    // Seed only once so reload tests exercise actual persisted data.
    if (!sessionStorage.getItem('recovery-fixture-seeded')) {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      sessionStorage.setItem('recovery-fixture-seeded', 'yes');
    }
    const store = localStorage;
    window.__fixtureRead = (key) => store.getItem(key);
    if (mode === 'getter') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Fixture denied', 'SecurityError'); } });
    if (mode === 'quota') {
      window.__fixtureQuota = true;
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === store && window.__fixtureQuota) throw new DOMException('Fixture quota exceeded', 'QuotaExceededError');
        return write.call(this, key, value);
      };
    }
    if (mode === 'no-locks') Object.defineProperty(navigator, 'locks', { value: undefined });
  }, { seed, mode });
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  });
  return context;
};
const open = async (context) => {
  const page = await context.newPage();
  await page.goto(url);
  await horizon(page).waitFor();
  return page;
};
const edit = async (page, value) => {
  await horizon(page).fill(String(value));
  await horizon(page).press('Enter');
};
const saved = (page, value) => page.waitForFunction(({ current, value }) => {
  const raw = window.__fixtureRead(current);
  return raw && JSON.parse(JSON.parse(raw).payload).settings.simulation.horizonMonths === value;
}, { current, value });
const exported = async (page, button = 'Export this document') => {
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await downloadReady;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const notice = (page) => page.getByRole('region', { name: 'Storage status' });

try {
  const normal = await newContext();
  const page = await open(normal);
  await edit(page, 121);
  await saved(page, 121);
  assert.equal((await exported(page, 'Save')).settings.simulation.horizonMonths, 121);
  const baseline = await page.evaluate((key) => localStorage.getItem(key), current);
  await page.reload();
  await horizon(page).waitFor();
  assert.equal(await horizon(page).inputValue(), '121');
  checks.push('Normal save and reload restore the authored document');

  const rawWith = (revision, months) => {
    const raw = JSON.parse(baseline);
    const document = JSON.parse(raw.payload);
    document.settings.simulation.horizonMonths = months;
    return JSON.stringify({ ...raw, revision, payload: JSON.stringify(document) });
  };
  const recovery = await newContext({ [current]: rawWith(2, 121), [temporary]: rawWith(3, 122) });
  const recovered = await open(recovery);
  assert.equal(await horizon(recovered).inputValue(), '122');
  assert.match(await notice(recovered).innerText(), /Recovered the newest valid temporary/);
  assert.equal(await recovered.evaluate((key) => localStorage.getItem(key), current), rawWith(2, 121));
  assert.equal(await recovered.evaluate((key) => localStorage.getItem(key), temporary), rawWith(3, 122));
  checks.push('Newer interrupted temporary work wins; startup does not rewrite either envelope');

  const legacy = await newContext({ [current]: '{broken', 'econgraph.document.v1.current': rawWith(90, 123) });
  const legacyPage = await open(legacy);
  assert.equal(await horizon(legacyPage).inputValue(), '123');
  assert.equal(await legacyPage.evaluate((key) => localStorage.getItem(key), current), '{broken');
  checks.push('Invalid NodeSim bytes do not hide valid legacy work or get overwritten at startup');

  const blocked = await newContext({ [current]: baseline }, 'getter');
  const blockedPage = await open(blocked);
  await notice(blockedPage).waitFor();
  await edit(blockedPage, 130);
  assert.equal((await exported(blockedPage)).settings.simulation.horizonMonths, 130);
  assert.equal(await blockedPage.evaluate((key) => window.__fixtureRead(key), current), baseline);
  await blockedPage.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await blockedPage.screenshot({ path: path.join(output, 'blocked-desktop.png'), fullPage: true });
  checks.push('Denied localStorage getter leaves desktop editable and exportable, theme usable, saved bytes unchanged');

  const quota = await newContext({ [current]: baseline }, 'quota');
  const quotaPage = await open(quota);
  await edit(quotaPage, 133);
  await quotaPage.getByRole('button', { name: 'Retry autosave', exact: true }).waitFor();
  await quotaPage.waitForFunction(() => document.querySelector('.storage-notice')?.textContent.includes('Fixture quota exceeded'));
  assert.equal((await exported(quotaPage)).settings.simulation.horizonMonths, 133);
  await quotaPage.setViewportSize({ width: 390, height: 844 });
  await quotaPage.getByRole('tab', { name: 'Graph', exact: true }).waitFor();
  assert.equal(await quotaPage.evaluate(() => document.documentElement.scrollWidth), 390);
  await quotaPage.screenshot({ path: path.join(output, 'quota-compact.png'), fullPage: true });
  await quotaPage.getByRole('tab', { name: 'Graph structure', exact: true }).click();
  await quotaPage.getByRole('button', { name: 'Export this document', exact: true }).focus();
  assert.equal(await quotaPage.getByRole('button', { name: 'Export this document', exact: true }).evaluate((element) => element === document.activeElement), true);
  await quotaPage.evaluate(() => { window.__fixtureQuota = false; });
  await quotaPage.getByRole('button', { name: 'Retry autosave', exact: true }).click();
  await saved(quotaPage, 133);
  assert.equal(await quotaPage.getByRole('button', { name: 'Retry autosave', exact: true }).count(), 0);
  checks.push('Quota failure keeps dirty/export state; compact warning has no overflow and Retry saves after storage recovers');

  const second = await open(normal);
  await edit(page, 140);
  await saved(page, 140);
  await second.waitForFunction(() => document.querySelector('.storage-notice')?.textContent.includes('another tab'));
  await edit(second, 141);
  assert.equal((await exported(second)).settings.simulation.horizonMonths, 141);
  assert.equal(JSON.parse(JSON.parse(await second.evaluate((key) => localStorage.getItem(key), current)).payload).settings.simulation.horizonMonths, 140);
  await second.getByRole('button', { name: 'Load saved version (local edits remain in Undo)', exact: true }).focus();
  await second.keyboard.press('Enter');
  await second.waitForFunction(() => document.querySelector('.toolbar-horizon input')?.value === '140');
  await second.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(second, 141);
  checks.push('Real tabs detect external saves, preserve local export, load explicitly by keyboard, and restore local edits through Undo');

  const pendingContext = await newContext({ [current]: baseline });
  const pendingPage = await open(pendingContext);
  await horizon(pendingPage).fill('145');
  const draftWarned = await pendingPage.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(draftWarned, true);
  assert.equal(JSON.parse(JSON.parse(await pendingPage.evaluate((key) => localStorage.getItem(key), current)).payload).settings.simulation.horizonMonths, 121);
  await horizon(pendingPage).press('Enter');
  await pendingPage.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await saved(pendingPage, 145);
  await pendingPage.reload();
  await horizon(pendingPage).waitFor();
  assert.equal(await horizon(pendingPage).inputValue(), '145');
  checks.push('Uncommitted numeric drafts trigger unload protection; pagehide flush persists accepted pending edits');

  const noLocks = await newContext({ [current]: baseline }, 'no-locks');
  const noLocksPage = await open(noLocks);
  await edit(noLocksPage, 150);
  await noLocksPage.waitForFunction(() => document.querySelector('.storage-notice')?.textContent.includes('Web Locks'));
  assert.equal((await exported(noLocksPage)).settings.simulation.horizonMonths, 150);
  assert.equal(await noLocksPage.evaluate((key) => localStorage.getItem(key), current), baseline);
  checks.push('Browsers without Web Locks remain editable/exportable without unsafe shared writes');

  assert.deepEqual(errors, []);
  checks.push('No browser page errors or console errors in tested workflows');
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ result: 'PASS', recordedAt: new Date().toISOString(), url, browser: browser.version(), checks, errors }, null, 2));
  console.log(JSON.stringify({ result: 'PASS', checks, output }, null, 2));
} catch (error) {
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ result: 'FAIL', recordedAt: new Date().toISOString(), url, checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
