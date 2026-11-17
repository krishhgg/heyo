---
name: verify-heyo
description: Drive the built heyo Chrome extension in Playwright's Chromium the way a user would, and save evidence. Use before every pull request, after any change to the extension, and whenever a claim about heyo's behavior needs proof from the real extension and not only unit tests.
---

# Verify heyo

heyo is a Chrome extension (Manifest V3). Its user-facing behavior happens in web pages, so proof means loading the built extension into a real Chromium, clicking, and reading what the extension recorded. Unit tests do not count as verification.

All commands run from the repo root.

## Launch

There is no long-lived instance. Build once, then each drive starts its own browser with a fresh profile and its own fixture server on a free port.

```bash
npm ci        # once per checkout
npm run build # after every change under src/
```

The build is ready when `dist/extension/manifest.json` exists and `npm run build` printed `Built heyo <version> into dist/extension`.

Playwright's Chromium must be installed. If a drive fails with "Executable doesn't exist", run `npx playwright install chromium`.

## Doctor

```bash
npm run verify -- doctor
```

It checks that the build exists, that its version matches `package.json`, that no file under `src/` is newer than the build, and that a browser with the extension loaded gets a reply from the content script on a fixture page. It prints `doctor: healthy` and exits 0, or lists each problem and exits 1. Run it first whenever a drive fails for a reason that does not look like the feature under test.

## Drive

```bash
npm run verify -- list                 # features that have a drive
npm run verify -- run <feature>        # headless
npm run verify -- run <feature> --headed
npm run verify -- run <feature> --video  # also records a .webm into the evidence folder
```

Each drive is a script in `scripts/drives/<feature>.mjs` that exports `drive(session)`. The session has:

- `page`, a Playwright page in a browser that has the extension loaded
- `worker`, the extension's service worker. Call the extension's own API with `worker.evaluate(() => heyo.<method>(...))`
- `baseUrl`, the fixture server. Pages live in `e2e/fixtures/`
- `evidence`, the folder to write proof into
- `log(line)`, which prints the line and adds it to the transcript

Drive pages with real pointer input (`page.mouse.move`, `page.mouse.click`). Do not call the extension's internals to fake a click. Read results through the same paths a user has: the extension's pages and its exported log.

The feature map in [features/README.md](features/README.md) lists every user-facing feature and its drive. A feature without a drive is unverified.

## Evidence

Every run writes to `.verify/evidence/<timestamp>-<feature>/`:

- `transcript.txt`, each step and the final `PASS` or `FAIL` line
- `result.json`, the state the drive read back from the extension
- screenshots, and a video with `--video`

A proof shows the user action and the resulting state, not only the final screen. For anything the extension stores, read it back from the extension and save it in `result.json`.

`.verify/` is ignored by git. Copy what a pull request needs into the PR description.

## Cleanup

Each run closes its own browser, stops its own fixture server and deletes its own temporary profile, including after a failure. Nothing else is touched. Evidence stays in `.verify/evidence/`. Delete old evidence by hand when it is no longer needed.

Never kill Chromium by process name. Other work on this machine may be using it.

## Helpers

- `scripts/verify.mjs` is the only entry point. `npm run verify -- <args>` calls it.
- `scripts/drives/*.mjs` are the per-feature drives.
- `e2e/helpers/extension.ts` launches Chromium with the extension. The Playwright tests and the drives share it.
- `e2e/server.mjs` serves the fixture pages.

## Keeping this skill current

A pull request that changes behavior updates the matching feature file and drive in the same pull request. A new user-facing feature gets a feature file, a drive and a line in the feature index.
