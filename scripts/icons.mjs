// Renders src/extension/icons/icon.svg into the PNG sizes Chrome wants.
// Run it after changing the SVG and commit the PNGs. The build only copies them.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/extension/icons/', import.meta.url));
const svg = await readFile(`${dir}icon.svg`, 'utf8');

const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `${dir}icon-${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('Wrote icon-16, icon-32, icon-48 and icon-128 into src/extension/icons');
