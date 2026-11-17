import { expect, test } from '../helpers/fixtures';
import { allow, missAndSend } from './replay';

test('developer.mozilla.org: a near miss on the theme button opens its menu once', async ({
  page,
  worker,
}) => {
  await allow(worker, 'developer.mozilla.org');
  await page.goto('https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted');

  const button = page.getByRole('button', { name: /theme/i }).first();
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await missAndSend(page, worker, button, /theme/i);

  // Expanded means the click arrived once. Twice would have closed the menu again.
  await expect(button).toHaveAttribute('aria-expanded', 'true');
});
