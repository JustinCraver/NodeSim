import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const roots = ['src', 'tests'];
const extensions = new Set(['.ts', '.tsx', '.mjs']);
const failures = [];

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute));
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
};

for (const directory of roots) {
  for (const file of await collectFiles(path.join(root, directory))) {
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (/[ \t]+$/u.test(line)) failures.push(`${relative}:${index + 1}: trailing whitespace`);
      if (/^(<{7}|={7}|>{7})/u.test(line)) failures.push(`${relative}:${index + 1}: merge marker`);
      if (/\b(?:describe|it|test)\.only\s*\(/u.test(line)) failures.push(`${relative}:${index + 1}: focused test`);
      if (/@ts-(?:ignore|nocheck)/u.test(line)) failures.push(`${relative}:${index + 1}: suppressed TypeScript check`);
    });

    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      for (const diagnostic of source.parseDiagnostics) {
        const location = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        failures.push(`${relative}:${location.line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Lint passed: syntax, merge markers, focused tests, and TypeScript suppression checks are clean.');
}
