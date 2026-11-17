// A short hash of the decision module's source. A log records which decision
// produced it, and a review made under one version is checked against the next.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDir = fileURLToPath(new URL('../src/decision', import.meta.url));

export async function decisionVersion(dir = defaultDir) {
  const hash = createHash('sha256');
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => join(e.parentPath, e.name))
    .sort();
  for (const file of files) hash.update(await readFile(file));
  return hash.digest('hex').slice(0, 12);
}
