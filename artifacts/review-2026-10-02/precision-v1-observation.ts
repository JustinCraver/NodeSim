import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { computeGraph } from '../../src/engine/computeGraph';
import { createGraphDocument, DEFAULT_SIMULATION_SETTINGS, graphDocumentToRuntimeGraph, serializeGraphDocument } from '../../src/document/graphDocument';
import { DOCUMENT_STORAGE_KEYS, GraphDocumentStorage } from '../../src/document/documentStorage';

const output = process.argv[2];
if (!output || process.argv.length < 3 || process.argv.length > 4) throw new Error('Supply a fresh observation JSON path and optional reference JSON path through vite-node --script.');
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const referenceBody = await readFile(process.argv[3] || 'artifacts/review-2026-10-02/precision-reference-2.json', 'utf8');
const reference = JSON.parse(referenceBody);
assert.equal(reference.productAcceptance, false);
assert.equal(reference.contractSha256, hash(await readFile('docs/adr/0002-money-precision.md')));
const canonical = (text: string) => text.includes('.') ? text.replace(/0+$/u, '').replace(/\.$/u, '') : text;
const assets = reference.assets.map((candidate: {
  id: string; initial: string; apr: string; contribution: string; target: string;
  horizonMonths: number; samples: string[]; endingBalance: string; targetState: unknown;
}) => {
  const document = createGraphDocument({
    nodes: [
      { id: 'income', label: 'Income', kind: 'income', baseValue: Number(candidate.contribution), timeUnit: 'per_month' },
      { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: Number(candidate.initial), interestRateAnnual: Number(candidate.apr) },
      { id: 'target', label: 'Target', kind: 'output', targetAmount: Number(candidate.target) },
    ],
    edges: [
      { id: 'income-asset', source: 'income', target: 'asset', kind: 'flow', weight: 1, lagMonths: 0 },
      { id: 'asset-target', source: 'asset', target: 'target', kind: 'flow', sourcePort: 'balance', weight: 1, lagMonths: 0 },
    ],
  }, { ...DEFAULT_SIMULATION_SETTINGS, horizonMonths: candidate.horizonMonths });
  const root = graphDocumentToRuntimeGraph(document);
  const result = computeGraph(root.nodes, root.edges, document.settings.simulation);
  assert.deepEqual(result.diagnostics, []);
  const asset = result.nodes.find((node) => node.id === 'asset')!;
  const target = result.nodes.find((node) => node.id === 'target')!;
  const samples = asset.timeseries!.map(String);
  return {
    id: candidate.id, currentMode: 'v1 IEEE-754', currentEndingBalance: String(asset.computedValue),
    proposedEndingBalance: candidate.endingBalance, currentTargetState: target.outputState,
    proposedTargetState: candidate.targetState,
    targetStateChanged: JSON.stringify(target.outputState) !== JSON.stringify(candidate.targetState),
    changedCanonicalSampleSpellings: samples.filter((sample, index) => canonical(sample) !== canonical(candidate.samples[index])).length,
    samples,
  };
});
const tenths = assets.find((caseResult: { id: string }) => caseResult.id === 'tenths-zero-apr')!;
assert.deepEqual(tenths.currentTargetState, { kind: 'month', month: 11 });
assert.deepEqual(tenths.proposedTargetState, { kind: 'month', month: 10 });
const formula = computeGraph([{ id: 'sum', label: 'Sum', kind: 'calc', formula: '0.1 + 0.2', outputType: 'scalar' }], []);
assert.equal(formula.nodes[0].computedValue, 0.30000000000000004);

// Observe a source-derived downgrade hazard only in a disposable in-memory Map.
// No browser, disk document, new schema, or real storage namespace is mutated.
const v1 = createGraphDocument({ nodes: [{ id: 'value', label: 'Retained v1', kind: 'value', baseValue: 1 }], edges: [] });
const unknown = JSON.stringify({ version: 1, revision: 2, payload: JSON.stringify({ ...v1, schemaVersion: 2 }) });
const retained = JSON.stringify({ version: 1, revision: 1, payload: serializeGraphDocument(v1) });
const records = new Map<string, string>([[DOCUMENT_STORAGE_KEYS.current, unknown], [DOCUMENT_STORAGE_KEYS.lastGood, retained]]);
const memory = {
  getItem: (key: string) => records.get(key) ?? null,
  setItem: (key: string, value: string) => { records.set(key, value); },
  removeItem: (key: string) => { records.delete(key); },
};
const storage = new GraphDocumentStorage(memory);
const loaded = storage.load(graphDocumentToRuntimeGraph(v1));
const loadKeptUnknownBytes = records.get(DOCUMENT_STORAGE_KEYS.current) === unknown;
storage.save(loaded.document);
const saveReplacedUnknownBytes = records.get(DOCUMENT_STORAGE_KEYS.current) !== unknown;
assert.equal(loaded.source, 'last-good');
assert.equal(loaded.saveBlocked, false);
assert.equal(loadKeptUnknownBytes, true);
assert.equal(saveReplacedUnknownBytes, true);

const sourceHashes = Object.fromEntries(await Promise.all([
  'src/engine/computeGraph.ts', 'src/engine/formula.ts', 'src/document/graphDocument.ts', 'src/document/documentStorage.ts',
].map(async (file) => [file, hash(await readFile(file))])));
await writeFile(output, `${JSON.stringify({
  kind: 'current-v1-source-observation', status: 'PASS', productAcceptance: false,
  referenceSha256: hash(referenceBody), sourceHashes,
  formula: { input: '0.1 + 0.2', currentValue: String(formula.nodes[0].computedValue), proposedValue: '0.3' },
  assets,
  storageDowngradeObservation: {
    fixture: 'in-memory unknown schema 2 current / valid v1 last-good', source: loaded.source,
    saveBlocked: loaded.saveBlocked, loadKeptUnknownBytes, saveReplacedUnknownBytes,
    conclusion: 'Future v2 data must not reuse slots writable by a frozen v1 reader.',
  },
}, null, 2)}\n`, { flag: 'wx' });
console.log('Current v1 observation retained: tenths target month 11 versus proposed 10; storage downgrade hazard confirmed only in disposable memory.');
