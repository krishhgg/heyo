// Packs dist/extension into dist/heyo-extension-<version>.zip, the file the
// Chrome Web Store takes and the one attached to a GitHub release.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = `${root}dist/extension`;
if (!existsSync(`${dir}/manifest.json`)) {
  console.error('dist/extension is missing. Run `npm run build` first.');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
const zip = `${root}dist/heyo-extension-${version}.zip`;
rmSync(zip, { force: true });
// -X leaves out extra file attributes, so the same build gives the same archive.
execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: dir });
console.log(
  `Wrote dist/heyo-extension-${version}.zip (${Math.round(statSync(zip).size / 1024)} KB)`,
);
