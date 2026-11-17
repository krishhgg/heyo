# Extension loads

A user loads the unpacked build from `dist/extension` into Chrome. The extension's service worker starts, and its content script runs in every page the user opens.

## Sub-features

- `load-unpacked` loads `dist/extension` with no manifest errors.
- `content-script` runs in the top frame of an HTTP page and answers the service worker.

## How to get to it (user POV)

- Open `chrome://extensions`, turn on Developer mode, choose `Load unpacked` and pick `dist/extension`.
- Open any web page.

## Driving it with verify.mjs

Preconditions:

- `npm run build` has run.

- **Load and ping.** Run `npm run verify -- run extension-loads`. The transcript shows `service worker is up: heyo <version>` and a content script reply of `{"ok":true,"version":"<version>","top":true}`, then `PASS extension-loads`.
- **Proof.** `result.json` holds the manifest the service worker reported and the content script's reply. `page.png` shows the fixture page.

## Gotchas

- The drive loads the extension with `--load-extension`, which only Playwright's Chromium accepts. Branded Chrome ignores that flag, so this drive does not prove the manual `Load unpacked` path.
- Content scripts do not run on `chrome://` pages, the Web Store, or file URLs. Use the fixture server.
- The service worker stops after about 30 seconds of idle time. A drive that waits longer must be ready for the worker to restart.
