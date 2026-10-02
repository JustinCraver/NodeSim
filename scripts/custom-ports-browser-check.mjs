import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const url = process.argv[2];
if (!url || !/^http:\/\/127\.0\.0\.1:\d+\/NodeSim\/$/u.test(url)) {
  throw new Error('Supply a dedicated loopback URL, e.g. http://127.0.0.1:5198/NodeSim/');
}
const output = path.resolve(process.argv[3] || 'artifacts/custom-ports-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
let activePage;
let lastExportAt = 0;
const settings = { simulation: { version: 1, horizonMonths: 120, contributionTiming: 'end-of-month', annualRateConvention: 'nominal-divided-by-12', monthZero: 'initial-balance' } };
const edge = (id, source, target, ports = {}) => ({ id, source, target, kind: 'flow', weight: 1, lagMonths: 0, ...ports });
const fixture = () => ({ schemaVersion: 1, settings, graph: {
  nodes: [
    { id: 'source', label: 'Source', kind: 'value', baseValue: 10 },
    { id: 'custom', label: 'Port Lab', kind: 'custom', custom: {
      inputs: [{ id: 'input', label: 'Input', valueType: 'scalar' }],
      outputs: [{ id: 'output', label: 'Output', valueType: 'scalar', formulaId: 'result' }],
      inputBindings: { input: 'value' }, outputBindings: { output: 'value' },
      internalGraph: { nodes: [
        { id: 'value', label: 'Value', kind: 'value', baseValue: 0 },
        { id: 'flow', label: 'Flow', kind: 'income', baseValue: 5, timeUnit: 'per_month' },
        { id: 'sum', label: 'Sum', kind: 'add', leftValue: 0, rightValue: 0 },
        { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 },
      ], edges: [edge('flow-sum', 'flow', 'sum', { targetPort: '1' }), edge('flow-sum-2', 'flow', 'sum', { targetPort: '2' })] },
    } },
    { id: 'sink', label: 'Sink', kind: 'value', baseValue: 0 },
    { id: 'goal', label: 'Goal', kind: 'output', targetAmount: 1 },
  ], edges: [edge('source-custom', 'source', 'custom', { targetPort: 'input' }), edge('custom-sink', 'custom', 'sink', { sourcePort: 'output' })],
} });
const activate = async (locator) => { await locator.focus(); await locator.press('Enter'); };
const select = async (locator, value) => {
  await locator.waitFor({ state: 'visible' });
  const index = await locator.locator('option').evaluateAll((options, value) => options.findIndex((option) => option.value === value), value);
  assert.ok(index >= 0, `Missing option ${value}; available: ${await locator.locator('option').evaluateAll((options) => options.map((option) => option.value))}`);
  await locator.focus();
  await locator.press('Home');
  for (let step = 0; step < index; step += 1) await locator.press('ArrowDown');
  await locator.press('Enter');
  assert.equal(await locator.inputValue(), value);
  await locator.press('Tab');
};
const exported = async (page) => {
  // Pace repeated user downloads; a burst can hit Chromium's download limiter.
  const interval = 250 - (Date.now() - lastExportAt);
  if (interval > 0) await new Promise((resolve) => setTimeout(resolve, interval));
  const ready = page.waitForEvent('download');
  await page.keyboard.press('Alt+s');
  const download = await ready;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  lastExportAt = Date.now();
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const openDocument = async (page, document) => {
  await page.getByLabel('Open', { exact: true }).setInputFiles({ name: 'ports-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await page.locator('.semantic-item-title').filter({ hasText: 'Port Lab' }).first().waitFor({ state: 'attached' });
};
const customOf = (document) => document.graph.nodes.find((node) => node.id === 'custom').custom;
const inspectCustom = async (page) => {
  const tab = page.getByRole('tab', { name: 'Graph structure', exact: true });
  if (await tab.count()) await activate(tab);
  await activate(page.getByRole('treeitem', { name: /Port Lab Custom graph/ }).first());
};
const portRow = (page, direction, id) => page.getByRole('region', { name: `${direction === 'input' ? 'Input' : 'Output'} port ${id}`, exact: true });
const undo = async (page) => { await page.keyboard.press('Alt+u'); };
const redo = async (page) => { await page.keyboard.press('Alt+r'); };
const begin = async (page, direction, id) => {
  await activate(id ? portRow(page, direction, id).getByRole('button', { name: `Edit ${direction}`, exact: true })
    : page.getByRole('button', { name: direction === 'input' ? 'Add Input' : 'Add Output', exact: true }));
  return page.getByRole('form', { name: `${id ? 'Edit' : 'Add'} ${direction} port`, exact: true });
};
const apply = async (form) => { await activate(form.getByRole('button', { name: 'Apply port', exact: true })); await form.waitFor({ state: 'detached' }); };

try {
  for (const [mode, viewport] of [['desktop', { width: 1440, height: 1000 }], ['compact', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.getByLabel('Horizon (months)', { exact: true }).waitFor();
    await openDocument(page, fixture());
    if (mode === 'compact') await activate(page.getByRole('tab', { name: 'Graph structure', exact: true }));
    await activate(page.getByRole('treeitem', { name: /Port Lab Custom graph/ }));
    const baseline = await exported(page);

    let form = await begin(page, 'input');
    await form.getByLabel('Port ID', { exact: true }).fill('extra_input');
    await form.getByLabel('Port label', { exact: true }).fill('Extra input');
    await select(form.getByLabel('Port type', { exact: true }), 'monthly-flow');
    await activate(form.getByRole('button', { name: 'Apply port', exact: true }));
    assert.match(await form.getByRole('alert').innerText(), /Choose an existing compatible/);
    assert.deepEqual(await exported(page), baseline);
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), true);
    await select(form.getByLabel('Internal binding', { exact: true }), 'flow');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    await page.screenshot({ path: path.join(output, `${mode}-input-draft.png`), fullPage: true });
    await apply(form);
    assert.equal(await page.getByRole('button', { name: 'Add Input', exact: true }).evaluate((element) => element === document.activeElement), true);
    const withInput = await exported(page);
    assert.equal(customOf(withInput).inputBindings.extra_input, 'flow');
    assert.deepEqual(customOf(withInput).internalGraph, customOf(baseline).internalGraph);
    await undo(page);
    assert.deepEqual(await exported(page), baseline);
    await redo(page);
    assert.deepEqual(await exported(page), withInput);
    checks.push(`${mode}: keyboard add input is atomic; rejected/uncommitted drafts do not export; unload protection and Undo/Redo work without creating nodes`);

    form = await begin(page, 'output');
    await form.getByLabel('Port ID', { exact: true }).fill('extra_output');
    await form.getByLabel('Port label', { exact: true }).fill('Balance');
    await select(form.getByLabel('Port type', { exact: true }), 'timeseries');
    await select(form.getByLabel('Internal binding', { exact: true }), 'asset');
    await form.getByLabel('Formula identity', { exact: true }).fill('bad identity');
    await activate(form.getByRole('button', { name: 'Apply port', exact: true }));
    assert.match(await form.getByRole('alert').innerText(), /must be a formula identifier/);
    assert.equal(await form.getByLabel('Formula identity', { exact: true }).inputValue(), 'bad identity');
    assert.deepEqual(await exported(page), withInput);
    await form.getByLabel('Formula identity', { exact: true }).fill('series');
    await apply(form);
    const withOutput = await exported(page);
    assert.equal(customOf(withOutput).outputBindings.extra_output, 'asset');
    assert.equal(customOf(withOutput).outputs.find((port) => port.id === 'extra_output').valueType, 'timeseries');
    if (mode === 'compact') await activate(page.getByRole('tab', { name: 'Graph', exact: true }));
    await activate(page.getByRole('button', { name: 'Connect', exact: true }));
    const connect = page.getByRole('dialog', { name: 'Connect nodes', exact: true });
    await select(connect.getByLabel('From'), 'custom');
    await select(connect.getByLabel('To'), 'goal');
    await connect.getByRole('button', { name: 'Create connection', exact: true }).press('Alt+Enter');
    await connect.waitFor({ state: 'detached' });
    const connected = await exported(page);
    assert.equal(connected.graph.edges.filter((edge) => edge.target === 'goal').length, 1, 'One keyboard connection must create one edge');
    assert.equal(connected.graph.edges.find((edge) => edge.target === 'goal').sourcePort, 'extra_output');
    await inspectCustom(page);
    await activate(portRow(page, 'output', 'extra_output').getByRole('button', { name: 'Remove output', exact: true }));
    assert.equal((await exported(page)).graph.edges.some((edge) => edge.target === 'goal'), false);
    await undo(page);
    assert.deepEqual(await exported(page), connected);
    checks.push(`${mode}: keyboard adds a typed asset-series output, retains rejected identity text, connects it, and Undo restores removed port and edge`);

    form = await begin(page, 'input', 'input');
    assert.equal(await form.getByLabel('Port ID', { exact: true }).getAttribute('readonly'), '');
    await select(form.getByLabel('Port type', { exact: true }), 'monthly-flow');
    assert.equal(await form.getByLabel('Internal binding', { exact: true }).inputValue(), '');
    await select(form.getByLabel('Internal binding', { exact: true }), 'flow');
    await apply(form);
    const inputChanged = await exported(page);
    assert.equal(customOf(inputChanged).inputs[0].id, 'input');
    assert.equal(customOf(inputChanged).inputs[0].valueType, 'monthly-flow');
    assert.equal(inputChanged.graph.edges.some((edge) => edge.id === 'source-custom'), false);
    await undo(page);
    assert.deepEqual(await exported(page), connected);

    form = await begin(page, 'output', 'output');
    await select(form.getByLabel('Port type', { exact: true }), 'monthly-flow');
    // Arithmetic output candidates must use authored type inference, not computed caches.
    await select(form.getByLabel('Internal binding', { exact: true }), 'sum');
    await form.getByLabel('Formula identity', { exact: true }).fill('renamed');
    await apply(form);
    const outputChanged = await exported(page);
    assert.equal(customOf(outputChanged).outputs[0].id, 'output');
    assert.equal(customOf(outputChanged).outputBindings.output, 'sum');
    assert.equal(outputChanged.graph.edges.some((edge) => edge.id === 'custom-sink'), false);
    await undo(page);
    assert.deepEqual(await exported(page), connected);
    await activate(portRow(page, 'input', 'input').getByRole('button', { name: 'Remove input', exact: true }));
    assert.equal((await exported(page)).graph.edges.some((edge) => edge.id === 'source-custom'), false);
    await undo(page);
    assert.deepEqual(await exported(page), connected);
    checks.push(`${mode}: keyboard edits type plus binding for both directions, preserves IDs/compatible edges, and Undo restores type changes and input removal with edges`);

    form = await begin(page, 'output', 'output');
    await form.getByLabel('Port label', { exact: true }).fill('Discard me');
    await form.getByLabel('Port label', { exact: true }).press('Escape');
    await form.waitFor({ state: 'detached' });
    assert.equal(await form.count(), 0);
    assert.equal(await portRow(page, 'output', 'output').getByRole('button', { name: 'Edit output', exact: true }).evaluate((element) => element === document.activeElement), true);
    assert.deepEqual(await exported(page), connected);
    form = await begin(page, 'input', 'input');
    await form.getByLabel('Port label', { exact: true }).fill('Discard on Undo');
    await undo(page);
    await form.waitFor({ state: 'detached' });
    assert.equal(await form.count(), 0);
    assert.deepEqual(await exported(page), withOutput);
    await redo(page);
    assert.deepEqual(await exported(page), connected);
    await openDocument(page, connected);
    assert.deepEqual(await exported(page), connected);
    if (mode === 'compact') await activate(page.getByRole('tab', { name: 'Graph structure', exact: true }));
    await activate(page.getByRole('treeitem', { name: /Port Lab Custom graph/ }));

    const graphDraft = structuredClone(customOf(connected).internalGraph);
    graphDraft.nodes = graphDraft.nodes.filter((node) => node.id !== 'value');
    await page.getByLabel('Internal graph', { exact: true }).fill(JSON.stringify(graphDraft));
    await activate(page.getByRole('button', { name: 'Apply Internal Graph', exact: true }));
    await page.getByRole('region', { name: 'Binding repair preview', exact: true }).waitFor();
    assert.deepEqual(await exported(page), connected);
    await activate(page.getByRole('button', { name: 'Repair bindings and apply graph', exact: true }));
    const repaired = await exported(page);
    assert.deepEqual(repaired.graph.edges, connected.graph.edges);
    assert.equal(customOf(repaired).inputBindings.input, 'repair-input-input');
    assert.equal(customOf(repaired).outputBindings.output, 'repair-output-output');
    await undo(page);
    assert.deepEqual(await exported(page), connected);
    await redo(page);
    assert.deepEqual(await exported(page), repaired);
    const invalid = structuredClone(repaired);
    customOf(invalid).inputBindings.input = 'absent';
    await openDocument(page, invalid);
    if (mode === 'compact') await activate(page.getByRole('tab', { name: 'Graph', exact: true }));
    await page.locator('.toolbar-file-error').waitFor();
    assert.match(await page.locator('.toolbar-file-error').innerText(), /unknown internal node absent/);
    assert.deepEqual(await exported(page), repaired);
    checks.push(`${mode}: Cancel/Escape and external Undo discard drafts; real JSON file round trip passes; graph repair is explicit/atomic/undoable and strict Open still rejects malformed bindings`);

    const nested = fixture();
    nested.graph.nodes.push({ id: 'outer', label: 'Outer', kind: 'custom', custom: {
      inputs: [], outputs: [], inputBindings: {}, outputBindings: {}, internalGraph: fixture().graph,
    } });
    await openDocument(page, nested);
    if (mode === 'compact') await activate(page.getByRole('tab', { name: 'Graph structure', exact: true }));
    await activate(page.getByRole('button', { name: 'Expand Outer', exact: true }));
    await activate(page.getByRole('group', { name: '/root contents', exact: true }).getByRole('treeitem', { name: /Port Lab Custom graph/ }).first());
    form = await begin(page, 'input');
    await form.getByLabel('Port ID', { exact: true }).fill('discard_on_scope');
    if (mode === 'compact') await activate(page.getByRole('tab', { name: 'Graph structure', exact: true }));
    await activate(page.getByRole('group', { name: '/root/outer contents', exact: true }).getByRole('treeitem', { name: /Port Lab Custom graph/ }));
    await page.getByRole('form').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('form').count(), 0);
    form = await begin(page, 'input');
    await form.getByLabel('Port ID', { exact: true }).fill('nested_input');
    await select(form.getByLabel('Internal binding', { exact: true }), 'value');
    await apply(form);
    const nestedResult = await exported(page);
    assert.equal(customOf(nestedResult).inputs.length, 1);
    const inner = nestedResult.graph.nodes.find((node) => node.id === 'outer').custom.internalGraph.nodes.find((node) => node.id === 'custom').custom;
    assert.equal(inner.inputBindings.nested_input, 'value');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    await page.screenshot({ path: path.join(output, `${mode}-nested-result.png`), fullPage: true });
    checks.push(`${mode}: repeated local IDs stay scoped, scope changes discard port drafts, and nested authoring exports the complete root without horizontal overflow`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  const receipt = { result: 'PASS', recordedAt: new Date().toISOString(), url, browser: browser.version(), checks, errors };
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ...receipt, output }, null, 2));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ result: 'FAIL', recordedAt: new Date().toISOString(), url, checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
