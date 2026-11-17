import { expect, test } from '../helpers/fixtures';
import { allow, missAndSend } from './replay';

test('en.wikipedia.org: a near miss on the main menu button opens the menu once', async ({
  page,
  worker,
}) => {
  await allow(worker, 'en.wikipedia.org');
  await page.goto('https://en.wikipedia.org/wiki/Fitts%27s_law');

  const toggle = page.locator('#vector-main-menu-dropdown-checkbox');
  await expect(toggle).not.toBeChecked();

  await missAndSend(page, worker, page.locator('#vector-main-menu-dropdown-label'), /main menu/i);

  // Checked means the click arrived once. Twice would have closed the menu again.
  await expect(toggle).toBeChecked();
  await expect(page.locator('#vector-main-menu')).toBeVisible();
});
