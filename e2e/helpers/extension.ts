// Launches Playwright's Chromium with the built extension loaded.
// This file has no local imports so that Node can also load it directly
// from the verification skill's scripts.
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const extensionDir = fileURLToPath(new URL('../../dist/extension', import.meta.url));

export interface ExtensionSession {
  context: BrowserContext;
  /** The extension's service worker. */
  worker: Worker;
  extensionId: string;
}

export async function launchWithExtension(
  userDataDir: string,
  options: { headless?: boolean; recordVideoDir?: string } = {},
): Promise<ExtensionSession> {
  if (!existsSync(`${extensionDir}/manifest.json`)) {
    throw new Error('dist/extension is missing. Run `npm run build` first.');
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    // The chromium channel runs the new headless mode, which supports extensions.
    channel: 'chromium',
    headless: options.headless ?? true,
    viewport: { width: 1280, height: 800 },
    recordVideo: options.recordVideoDir ? { dir: options.recordVideoDir } : undefined,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId };
}
