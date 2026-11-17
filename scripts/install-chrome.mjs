// Builds the extension and gets Chrome ready to load it. Chrome only loads an
// unpacked extension through its own page, so the last step is by hand.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = `${root}dist/extension`;

execFileSync(process.execPath, [`${root}scripts/build.mjs`], { stdio: 'inherit' });

if (process.platform === 'darwin') {
  spawnSync('pbcopy', { input: dir });
  // Chrome does not open chrome:// pages handed to it from outside, so this
  // only brings Chrome forward. The page is one paste away.
  spawnSync('open', ['-a', 'Google Chrome']);
}

console.log(`
The extension is built in:
  ${dir}
${process.platform === 'darwin' ? 'That path is on the clipboard, and Chrome is in front.\n' : ''}
In Chrome:
  1. Open chrome://extensions
  2. Turn on "Developer mode" (top right)
  3. Click "Load unpacked", press Cmd+Shift+G, paste the path, press Enter, then "Select"

heyo starts in shadow mode. It logs and changes nothing. Click its toolbar
button to review what it logged. To update later, run this again and click the
reload arrow on heyo's card.
`);
