import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index].startsWith('--')) args.set(process.argv[index].slice(2), process.argv[index + 1]), index += 1;
}
const root = process.cwd();
const site = path.resolve(root, args.get('site') ?? 'dist');
const basePath = args.get('base') ?? '/NodeSim/';
const expectedTitle = args.get('title') ?? 'NodeSim';
const output = args.get('output');
if (!basePath.startsWith('/') || !basePath.endsWith('/')) throw new Error('Base path must start and end with /.');

const headers = JSON.parse(await readFile(path.join(root, 'deployment', 'security-headers.json'), 'utf8'));
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

const collectFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute));
    else files.push(absolute);
  }
  return files;
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith(basePath)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice(basePath.length)) || 'index.html';
    const absolute = path.resolve(site, relative);
    if (absolute !== site && !absolute.startsWith(`${site}${path.sep}`)) {
      response.writeHead(400).end('Invalid path');
      return;
    }
    const metadata = await stat(absolute);
    if (!metadata.isFile()) throw new Error('Not a file');
    const body = await readFile(absolute);
    response.writeHead(200, {
      ...headers,
      'Cache-Control': relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Length': body.length,
      'Content-Type': contentTypes.get(path.extname(absolute)) ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Smoke server did not expose a port.');
  const origin = `http://127.0.0.1:${address.port}`;
  const files = await collectFiles(site);
  const requests = [];
  for (const file of files) {
    const relative = path.relative(site, file).replaceAll(path.sep, '/');
    const url = relative === 'index.html' ? `${origin}${basePath}` : `${origin}${basePath}${relative}`;
    const response = await fetch(url);
    if (response.status !== 200) throw new Error(`${url} returned ${response.status}`);
    for (const [name, expected] of Object.entries(headers)) {
      if (response.headers.get(name) !== expected) throw new Error(`${url} header ${name} did not match the deployment contract.`);
    }
    await response.arrayBuffer();
    requests.push({ path: new URL(url).pathname, status: response.status });
  }

  const indexResponse = await fetch(`${origin}${basePath}`);
  const index = await indexResponse.text();
  if (!index.includes(`<title>${expectedTitle}</title>`)) throw new Error(`Expected ${expectedTitle} title was not present.`);
  const references = [...index.matchAll(/(?:src|href)="([^"]+)"/gu)].map((match) => match[1]);
  const invalidReferences = references.filter((reference) => !reference.startsWith(basePath));
  if (invalidReferences.length > 0) throw new Error(`Assets escaped ${basePath}: ${invalidReferences.join(', ')}`);
  const rootResponse = await fetch(`${origin}/`);
  if (basePath !== '/' && rootResponse.status !== 404) throw new Error('Root unexpectedly served the project-path artifact.');

  const evidence = {
    schemaVersion: 1,
    product: 'NodeSim',
    expectedTitle,
    basePath,
    site: path.relative(root, site).replaceAll(path.sep, '/'),
    exactPathStatus: indexResponse.status,
    outsideBaseStatus: rootResponse.status,
    assetCount: files.length - 1,
    requests,
    securityHeaders: headers,
  };
  if (output) await writeFile(path.resolve(root, output), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Deployed-path smoke passed: ${basePath} and ${files.length - 1} assets returned 200 with the required headers.`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
