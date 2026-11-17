// Builds the unpacked extension into dist/extension.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    review: 'src/extension/pages/review/main.tsx',
  },
  jsx: 'automatic',
  jsxImportSource: 'preact',
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  legalComments: 'none',
  logLevel: 'warning',
  define: { __HEYO_DECISION_VERSION__: JSON.stringify(await decisionVersion()) },
});

await mkdir(`${out}/fonts`, { recursive: true });
await mkdir(`${out}/icons`, { recursive: true });
for (const [from, to] of [
  ['src/extension/pages/review.html', 'review.html'],
  ['src/extension/pages/review.css', 'review.css'],
  [
    'node_modules/@fontsource-variable/recursive/files/recursive-latin-full-normal.woff2',
    'fonts/recursive.woff2',
  ],
  ...[16, 32, 48, 128].map((size) => [
    `src/extension/icons/icon-${size}.png`,
    `icons/icon-${size}.png`,
  ]),
]) {
  await copyFile(`${root}${from}`, `${out}/${to}`);
}

console.log(`Built heyo ${manifest.version} into dist/extension`);
