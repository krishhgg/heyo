#!/usr/bin/env node
// Entry point for the scripted run. The logic is TypeScript in scripted/main.ts.
// This file bundles it and hands it a browser and the fixture server.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension } from '../e2e/helpers/extension.ts';
import { startFixtureServer } from '../e2e/server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = await mkdtemp(join(tmpdir(), 'heyo-scripted-cli-'));
const outfile = join(cache, 'main.mjs');
await build({
  entryPoints: [join(root, 'scripted/main.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
});

const tools = {
  launch: (profileDir) => launchWithExtension(profileDir),
  async serve() {
    const { server, port } = await startFixtureServer(0);
    return { port, close: () => new Promise((resolve) => server.close(resolve)) };
  },
};

try {
  const { main } = await import(outfile);
  process.exitCode = await main(process.argv.slice(2), tools);
} finally {
  await rm(cache, { recursive: true, force: true });
}
