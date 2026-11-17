// Makes the Chrome Web Store screenshots (1280 by 800) and the small promo
// tile (440 by 280) from the built extension. Run `npm run build` first.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension } from '../e2e/helpers/extension.ts';
import { startFixtureServer } from '../e2e/server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const shots = join(root, 'store/screenshots');
await mkdir(shots, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'heyo-store-'));
const { server, port } = await startFixtureServer(0);
const { context, worker, extensionId } = await launchWithExtension(join(work, 'profile'));

try {
  // Real near misses on the small app fixture, so the first drawing is of a real page.
  const page = context.pages()[0];
  await page.goto(`http://127.0.0.1:${port}/app.html`);
  for (const name of ['Refresh', 'Compose', 'Starred']) {
    const control = page
      .getByRole('button', { name, exact: true })
      .or(page.getByRole('link', { name, exact: true }));
    const box = await control.first().boundingBox();
    await page.mouse.move(box.x - 120, box.y + 90);
    await page.mouse.move(box.x + box.width / 2, box.y - 3, { steps: 9 });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
  }

  const review = await context.newPage();
  await review.setViewportSize({ width: 1280, height: 800 });
  await review.goto(`chrome-extension://${extensionId}/review.html`);
  await review.locator('.plate').waitFor();
  await review.screenshot({ path: join(shots, '1-review.png') });

  // Four weeks of synthetic clicks, so the numbers pages have something to show.
  const log = join(work, 'synth.json');
  execFileSync(process.execPath, [
    join(root, 'scorer/cli.mjs'),
    'synth',
    '--days',
    '28',
    '--out',
    log,
  ]);
  await worker.evaluate((seed) => heyo.importLog(seed), JSON.parse(await readFile(log, 'utf8')));
  await review.reload();
  await review.getByRole('button', { name: 'Numbers' }).click();
  await review.locator('.sheet').first().waitFor();
  await review.screenshot({ path: join(shots, '2-numbers.png') });
  await review.getByRole('button', { name: 'Retargeting' }).click();
  await review.locator('.sheet').first().waitFor();
  await review.screenshot({ path: join(shots, '3-retargeting.png') });

  // The promo tile uses the extension's own typeface and colors.
  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.goto(`chrome-extension://${extensionId}/review.html`);
  await tile.evaluate(() => {
    document.body.innerHTML = `
      <div style="display:grid;place-content:center;gap:10px;height:280px;padding:0 44px;background:var(--paper)">
        <div class="wordmark" style="font-size:76px">heyo</div>
        <div style="--casl:1;font-size:21px;font-weight:700;line-height:1.25;color:var(--ink)">
          Miss a button by a few pixels and it still gets clicked.
        </div>
      </div>`;
  });
  await tile.screenshot({ path: join(root, 'store/promo-440x280.png') });
  console.log(
    'Wrote store/screenshots/1-review.png, 2-numbers.png, 3-retargeting.png and store/promo-440x280.png',
  );
} finally {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(work, { recursive: true, force: true });
}
