#!/usr/bin/env node
// Entry point for the practice run. The logic is TypeScript in practice/main.ts.
// This file bundles it and hands it a browser window and a server for the
// practice page.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension } from '../e2e/helpers/extension.ts';
import { startFixtureServer } from '../e2e/server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = await mkdtemp(join(tmpdir(), 'heyo-practice-cli-'));
const outfile = join(cache, 'main.mjs');
await build({
  entryPoints: [join(root, 'practice/main.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
});

const tools = {
  launch: (profileDir) =>
    launchWithExtension(profileDir, { headless: false, window: { width: 1100, height: 860 } }),
  async serve() {
    const { server, port } = await startFixtureServer(0, join(root, 'practice/page'));
    return { port, close: () => new Promise((resolve) => server.close(resolve)) };
  },
};

try {
  const { main } = await import(outfile);
  process.exitCode = await main(process.argv.slice(2), tools);
} finally {
  await rm(cache, { recursive: true, force: true });
}
