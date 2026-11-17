#!/usr/bin/env node
// Entry point for the offline scorer. The logic is TypeScript in scorer/main.ts.
// This file bundles it and runs it.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { bundle, cacheDir, decisionPlugin, root } from './bundle.mjs';

const { main } = await import(await bundle(join(root, 'scorer/main.ts'), 'main'));

let workers = 0;
const tools = {
  root,
  bundleWorker: (decisionDir) =>
    bundle(join(root, 'scorer/worker.ts'), `worker-${workers++}`, [decisionPlugin(decisionDir)]),
};

try {
  process.exitCode = await main(process.argv.slice(2), tools);
} finally {
  await rm(await cacheDir(), { recursive: true, force: true });
}
