// A short hash of the decision's source: the module itself and the two core
// files it may import, whose constants and helpers are part of what it does. A
// log records which decision produced it, and retargeting acts only under the
// version the gates passed with.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDir = fileURLToPath(new URL('../src/decision', import.meta.url));
const coreDir = fileURLToPath(new URL('../src/core', import.meta.url));

export async function decisionVersion(dir = defaultDir) {
  const hash = createHash('sha256');
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => join(e.parentPath, e.name))
    .sort();
  for (const name of ['geometry.ts', 'types.ts']) files.push(join(coreDir, name));
  for (const file of files) hash.update(await readFile(file));
  return hash.digest('hex').slice(0, 12);
}
