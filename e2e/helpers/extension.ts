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
  options: {
    headless?: boolean;
    recordVideoDir?: string;
    scrollbars?: boolean;
    /** A real window of this size, at the screen's own pixel ratio, for a person to use. */
    window?: { width: number; height: number };
  } = {},
): Promise<ExtensionSession> {
  if (!existsSync(`${extensionDir}/manifest.json`)) {
    throw new Error('dist/extension is missing. Run `npm run build` first.');
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    // The chromium channel runs the new headless mode, which supports extensions.
    channel: 'chromium',
    headless: options.headless ?? true,
    viewport: options.window ? null : { width: 1280, height: 800 },
    recordVideo: options.recordVideoDir ? { dir: options.recordVideoDir } : undefined,
    // Playwright hides every scrollbar in headless mode. A test of a press on one needs them.
    ignoreDefaultArgs: options.scrollbars ? ['--hide-scrollbars'] : undefined,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      // Any *.heyo.test name reaches the local fixture server. Unlike localhost,
      // such a page is not a secure context, which is what a plain HTTP site is.
      '--host-resolver-rules=MAP *.heyo.test 127.0.0.1',
      ...(options.window ? [`--window-size=${options.window.width},${options.window.height}`] : []),
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId };
}
