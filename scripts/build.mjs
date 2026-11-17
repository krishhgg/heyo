// Builds the unpacked extension into dist/extension.
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decisionVersion } from './decision-version.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist/extension`;

const pkg = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
const manifest = JSON.parse(await readFile(`${root}src/extension/manifest.json`, 'utf8'));
manifest.version = pkg.version;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

await build({
  absWorkingDir: root,
  entryPoints: {
    background: 'src/extension/background/index.ts',
    content: 'src/extension/content/index.ts',
    'main-world': 'src/extension/main-world/index.ts',
  },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  legalComments: 'none',
  logLevel: 'warning',
  define: { __HEYO_DECISION_VERSION__: JSON.stringify(await decisionVersion()) },
});

console.log(`Built heyo ${manifest.version} into dist/extension`);
