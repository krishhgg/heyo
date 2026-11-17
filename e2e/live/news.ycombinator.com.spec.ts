import { expect, test } from '../helpers/fixtures';
import { allow, missAndSend } from './replay';

test('news.ycombinator.com: a near miss on the login link opens the login page once', async ({
  page,
  worker,
}) => {
  await allow(worker, 'news.ycombinator.com');
  await page.goto('https://news.ycombinator.com/');

  const navigations: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  await missAndSend(page, worker, page.getByRole('link', { name: 'login', exact: true }), /login/i);

  await expect(page).toHaveURL(/news\.ycombinator\.com\/login/);
  expect(navigations.filter((url) => url.includes('/login'))).toHaveLength(1);
});
