import { test as base, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchWithExtension } from './extension';

interface ExtensionFixtures {
  context: BrowserContext;
  /** The extension's service worker. */
  worker: Worker;
  extensionId: string;
}

/** Each test gets a fresh browser profile with the built extension loaded. */
export const test = base.extend<ExtensionFixtures & { session: ExtensionFixtures }>({
  session: async ({ headless }, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'heyo-e2e-'));
    const session = await launchWithExtension(userDataDir, { headless });
    await use(session);
    await session.context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },
  context: async ({ session }, use) => use(session.context),
  worker: async ({ session }, use) => use(session.worker),
  extensionId: async ({ session }, use) => use(session.extensionId),
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export const expect = test.expect;
