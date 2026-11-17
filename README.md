# heyo

Forgiving clicks. When a mouse click lands on empty, non-interactive space and one nearby clickable element is clearly the one you aimed for, heyo sends the click to that element. Clicks that already hit something are never touched.

heyo is a Chrome extension. It starts in shadow mode, where it only logs what it would have done. Retargeting unlocks when your own log shows it would be right.

- [docs/plan.md](docs/plan.md) is the approved plan: the mechanics, the metric and the stop conditions.
- [docs/decisions.md](docs/decisions.md) records each default chosen during the build and why.
- [docs/status.md](docs/status.md) says what works today and what is left.
- [docs/privacy.md](docs/privacy.md) is the privacy policy.

## Install

You need Node 26 or later and Google Chrome.

```bash
git clone https://github.com/krishhgg/heyo && cd heyo && npm ci && npm run install:chrome
```

That builds the extension, brings Chrome to the front and puts the folder's path on the clipboard. Chrome only loads an unpacked extension through its own page, so finish there:

1. Open `chrome://extensions`.
2. Turn on Developer mode, top right.
3. Click Load unpacked, press Cmd+Shift+G, paste, press Enter, then Select.

Without Node, download `heyo-extension-<version>.zip` from the [latest release](https://github.com/krishhgg/heyo/releases/latest), unzip it, and pick that folder in step 3.

To update, pull, run `npm run install:chrome` again, and click the reload arrow on heyo's card.

## The first two weeks

heyo runs in shadow mode. It changes nothing on any page. Browse as usual.

Click the heyo toolbar button to open the review page.

- **Review** shows each click heyo would have sent on as a drawing to scale: where you clicked, what was near, and the control it would have picked. Mark it with `Y` for right, `N` for wrong or `U` for not sure. `Z` goes back. About 300 marks with none wrong are enough for the gate.
- **Numbers** shows the miss rate against the plan's stop condition, recovery, and the wrong-target bound. It also exports the log to a file and deletes it.
- **Retargeting** has the switch. It stays locked until both gates pass on your own log.

After two weeks, Numbers says whether misses are common enough to go on: at least 0.5% of clicks and 3 a day.

## Retargeting

When the gates pass you can turn retargeting on. heyo then clicks the control you aimed for, on the sites in [src/extension/allowlist.ts](src/extension/allowlist.ts) only. A site gets on that list with a scripted near miss in `e2e/live/` that makes the intended action happen exactly once.

If heyo clicks something you did not mean, open the Retargeting tab and mark that click wrong. It turns itself off after a wrong click that could not be undone, after more than one in a week, and whenever your log stops passing the gates, such as after you delete it.

## Score a log

```bash
npm run synth -- --out synth.json   # or export a real log from the review page
npm run score -- synth.json
npm run gates -- synth.json
```

`npm run scripted -- --out scripted.json` plays the same synthetic clicks with a real mouse through the built extension, and writes the log the extension kept. Score it the same way.

[docs/scoring.md](docs/scoring.md) explains the report, the held-out split and what a decision can see.

## Improve the decision with an agent

```bash
npm run loop -- --log heyo-log.json --agent "<command that starts a coding agent>"
```

[docs/agent-loop.md](docs/agent-loop.md) explains what the agent gets and what keeps the result honest.

## Develop

```bash
npm ci
npx playwright install chromium
npm run build      # unpacked extension in dist/extension
npm run lint       # eslint, prettier, tsc and the decision lint
npm test           # unit tests
npm run e2e        # Playwright tests against the built extension
npm run e2e:live   # replay tests against the real sites on the allowlist
npm run verify -- doctor   # health check for the verification skill
npm run package    # dist/heyo-extension-<version>.zip
```

`npm run e2e` and `npm run verify` need a fresh `npm run build`. The verification skill in `.claude/skills/verify-heyo` drives the built extension in a real browser and saves evidence. Use it before every pull request.

## Chrome Web Store

[store/listing.md](store/listing.md) has the listing text, the permission justifications and the data disclosures. `npm run store:shots` regenerates the screenshots and the promo tile in `store/`.

## Mac app

`mac/` holds the feasibility experiment for a macOS version. It has not been run yet, because it needs Accessibility permission. [docs/mac-feasibility.md](docs/mac-feasibility.md) says how to run it and how to read the result.

```bash
cd mac
swift test                                  # the parts that need no permission
swift run -c release heyo-feasibility check # says whether the permission is there
```
