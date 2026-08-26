import { createGzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const root = process.cwd();
const dist = path.join(root, 'dist');
const budgets = {
  totalRawBytes: 850 * 1024,
  javascriptRawBytes: 800 * 1024,
  javascriptGzipBytes: 250 * 1024,
  cssRawBytes: 40 * 1024,
};

const collectFiles = async (directory) => {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(absolute));
    else result.push(absolute);
  }
  return result;
};

const gzipSize = async (file) => {
  let bytes = 0;
  await pipeline(createReadStream(file), createGzip({ level: 9 }), new Writable({ write(chunk, _encoding, callback) { bytes += chunk.length; callback(); } }));
  return bytes;
};

const files = await collectFiles(dist);
const details = [];
for (const file of files) {
  const size = (await stat(file)).size;
  details.push({ file: path.relative(dist, file).replaceAll(path.sep, '/'), size, gzip: await gzipSize(file) });
}
const sum = (predicate, field) => details.filter(predicate).reduce((total, item) => total + item[field], 0);
const actual = {
  totalRawBytes: sum(() => true, 'size'),
  javascriptRawBytes: sum((item) => item.file.endsWith('.js'), 'size'),
  javascriptGzipBytes: sum((item) => item.file.endsWith('.js'), 'gzip'),
  cssRawBytes: sum((item) => item.file.endsWith('.css'), 'size'),
};
const failures = Object.entries(budgets).filter(([name, limit]) => actual[name] > limit);
for (const [name, limit] of Object.entries(budgets)) console.log(`${name}: ${actual[name]} / ${limit} bytes`);
if (failures.length > 0) {
  console.error(`Bundle budget exceeded: ${failures.map(([name]) => name).join(', ')}`);
  process.exitCode = 1;
}
