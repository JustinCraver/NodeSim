import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const coverageRoot = path.join(root, 'coverage');
const rawDirectory = path.join(coverageRoot, 'raw');
const minimumBytePercent = 80;
const minimumFunctionPercent = 80;
const requiredCoreModules = new Set([
  'src/document/documentStorage.ts',
  'src/document/documentStore.ts',
  'src/document/graphDocument.ts',
  'src/engine/computeGraph.ts',
  'src/engine/connectionValidation.ts',
  'src/engine/formula.ts',
  'src/graph/controllerLifecycle.ts',
  'src/graph/customBindings.ts',
  'src/graph/graphScope.ts',
]);

await rm(rawDirectory, { recursive: true, force: true });
await mkdir(rawDirectory, { recursive: true });

const vitest = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=dot'],
  {
    cwd: root,
    env: { ...process.env, NODE_V8_COVERAGE: rawDirectory },
    encoding: 'utf8',
    stdio: 'inherit',
  },
);
if (vitest.status !== 0) process.exit(vitest.status ?? 1);

const scripts = [];
for (const name of await readdir(rawDirectory)) {
  if (!name.endsWith('.json')) continue;
  const report = JSON.parse(await readFile(path.join(rawDirectory, name), 'utf8'));
  scripts.push(...report.result);
}

const normalizeSourcePath = (url) => {
  if (!url.startsWith('file:')) return undefined;
  const absolute = fileURLToPath(url);
  const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
  return relative.startsWith('src/') && relative.endsWith('.ts') ? relative : undefined;
};

const summarizeBytes = (functions) => {
  const ranges = functions.flatMap((entry) => entry.ranges);
  const points = [...new Set(ranges.flatMap((range) => [range.startOffset, range.endOffset]))].sort((a, b) => a - b);
  let total = 0;
  let covered = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const containing = ranges
      .filter((range) => range.startOffset <= start && range.endOffset >= end)
      .sort((left, right) => (left.endOffset - left.startOffset) - (right.endOffset - right.startOffset));
    if (containing.length === 0) continue;
    const size = end - start;
    total += size;
    if (containing[0].count > 0) covered += size;
  }
  return { covered, total };
};

const byFile = new Map();
for (const script of scripts) {
  const relative = normalizeSourcePath(script.url);
  if (!relative) continue;
  const byteSummary = summarizeBytes(script.functions);
  const functionTotal = script.functions.length;
  const functionCovered = script.functions.filter((entry) => entry.ranges[0]?.count > 0).length;
  const existing = byFile.get(relative) ?? { bytes: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } };
  existing.bytes.covered += byteSummary.covered;
  existing.bytes.total += byteSummary.total;
  existing.functions.covered += functionCovered;
  existing.functions.total += functionTotal;
  byFile.set(relative, existing);
}

const missing = [...requiredCoreModules].filter((file) => !byFile.has(file));
const totals = [...byFile.values()].reduce(
  (sum, item) => ({
    bytes: { covered: sum.bytes.covered + item.bytes.covered, total: sum.bytes.total + item.bytes.total },
    functions: { covered: sum.functions.covered + item.functions.covered, total: sum.functions.total + item.functions.total },
  }),
  { bytes: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } },
);
const percent = (value) => value.total === 0 ? 0 : Number((value.covered * 100 / value.total).toFixed(2));
const summary = {
  format: 'node-v8-transformed-source-coverage-v1',
  scope: 'core TypeScript modules exercised by the deterministic Vitest suite',
  thresholds: { bytes: minimumBytePercent, functions: minimumFunctionPercent },
  totals: {
    bytes: { ...totals.bytes, percent: percent(totals.bytes) },
    functions: { ...totals.functions, percent: percent(totals.functions) },
  },
  files: Object.fromEntries([...byFile.entries()].sort()),
  missingRequiredModules: missing,
};
await mkdir(coverageRoot, { recursive: true });
await writeFile(path.join(coverageRoot, 'coverage-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Coverage: ${summary.totals.bytes.percent}% transformed bytes, ${summary.totals.functions.percent}% functions across ${byFile.size} modules.`);

if (missing.length > 0 || summary.totals.bytes.percent < minimumBytePercent || summary.totals.functions.percent < minimumFunctionPercent) {
  if (missing.length > 0) console.error(`Missing required modules: ${missing.join(', ')}`);
  console.error(`Coverage must meet ${minimumBytePercent}% bytes and ${minimumFunctionPercent}% functions.`);
  process.exitCode = 1;
}
