#!/usr/bin/env node
// Entry point for the agent loop and its lint. The logic is TypeScript in loop/main.ts.
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { bundle, cacheDir, decisionPlugin, root } from '../scorer/bundle.mjs';

// The lint parses code with the TypeScript package. It stays out of the bundle
// and loads from this repo's node_modules, wherever the bundle is written.
const typescript = {
  name: 'typescript-from-repo',
  setup(esbuild) {
    esbuild.onResolve({ filter: /^typescript$/ }, () => ({
      path: join(root, 'node_modules/typescript/lib/typescript.js'),
      external: true,
    }));
  },
};

const { main } = await import(await bundle(join(root, 'loop/main.ts'), 'loop', [typescript]));

let workers = 0;
const tools = {
  root,
  bundleWorker: (decisionDir) =>
    bundle(join(root, 'scorer/worker.ts'), `worker-${workers++}`, [decisionPlugin(decisionDir)]),
  canSandbox: process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'),
  // Worker bundles are written here and then run. The agent must not get at them.
  privateDirs: [await cacheDir()],
};

try {
  process.exitCode = await main(process.argv.slice(2), tools);
} finally {
  await rm(await cacheDir(), { recursive: true, force: true });
}
