# Retargeting

With retargeting on, a click that lands on empty space on an allowed site, that the page ignores, and that the decision would retarget, is sent on to the picked control. The switch is on the review page's `Retargeting` tab and stays locked until the local log passes both gates.

## Sub-features

- `gate-lock` refuses to turn retargeting on until recovery and the wrong-target rate both pass on the local log.
- `send` dispatches one click on the picked control, so its action happens exactly once.
- `allowlist` acts only on sites in `src/extension/allowlist.ts`, and only in the top frame.
- `held` holds one fire in ten back as a control and logs it as `held`.
- `refusals` sends nothing when the user is already pressing again, the control moved, or it is covered.
- `double-click-wait` optionally waits half a second and sends nothing if a second press comes first.
- `wrong-report` records a wrong click as a wrong review mark and turns retargeting off when the rules say so.
- `badge` marks the toolbar button for a moment after a click is sent on.
- `live-sites` checks each allowed real site with a scripted near miss.

## How to get to it (user POV)

- Click the heyo toolbar button, choose `Retargeting`, then `Turn retargeting on`. The button is disabled until both gates pass.
- Browse an allowed site and click just beside a control.
- Back on the `Retargeting` tab, use `Wrong` beside a sent click that was not what you meant.

## Driving it with verify.mjs

Preconditions:

- `npm run build` has run.

- **Whole flow on a fixture page.** Run `npm run verify -- run retargeting`. The drive shows the switch refused on an empty log, seeds a passing log through the service worker's `importLog`, turns retargeting on in the review page, and makes four near misses on `replay.html`. The transcript shows `actions on the page after four near misses: ["plain","#linked","delegated","submitted"]`, that a near miss beside `Delete` was left alone, the logged fires, and `mode=shadow, offReason=irreversible` after a wrong-click report. It ends with `PASS retargeting`.
- **Proof.** `1-unlocked.png` is the tab with both gates passing, `2-page-after.png` the fixture page after the near misses, `3-sent.png` the tab listing the sent clicks, and `4-off.png` the tab after the report. `result.json` holds the page's actions, each fire and the final settings.
- **Real sites.** Run `npm run e2e:live`. Each file in `e2e/live/` loads one allowed site, misses one control by 4 px and checks the intended action happened once. These need the network and are not part of the required checks.
- **Other cases.** `npx playwright test e2e/retarget.spec.ts` covers every control type on the fixture, pages that only trust real input, popups, file pickers, the double-click wait, held fires and the reports.

## Gotchas

- The drive seeds the log with `heyo.importLog` and sets the held share to 0 with `heyo.setHeldShare`. Both are test hooks on the service worker. A user reaches a passing log only by browsing and reviewing.
- The decision needs the cursor to have moved in the 300 ms before the press. A drive that clicks without moving the mouse first gets no fire.
- heyo watches a sent click for 400 ms before it logs the outcome. Read the log at least 600 ms after a near miss.
- A popup or a new tab takes focus from a real window, which heyo counts as a reaction. A Playwright window keeps focus, so `reacted` is false there.
- A fire is `failed` with `second-press` when the user presses again within the first click's 50 ms settle time. A test of that case depends on timing and skips itself when the retry comes later.
