# Retargeting

With retargeting on, a click that lands on empty space on an allowed site, that the page ignores, and that the decision would retarget, is sent on to the picked control. The switch is on the review page's `Retargeting` tab and stays locked until the local log passes both gates.

## Sub-features

- `gate-lock` refuses to turn retargeting on until recovery and the wrong-target rate both pass on the local log, and turns it off again when they stop passing: after a mark, a delete, a new record or a restart of the service worker.
- `send` dispatches one click on the picked control, so its action happens exactly once.
- `allowlist` acts only on sites in `src/extension/allowlist.ts`, and only in the top frame. No copy of the list is stored.
- `held` holds one fire in ten back as a control and logs it as `held`.
- `double-click` sends the first click of a double-click on and never the second.
- `refusals` sends nothing when the user is already pressing again or presses a key, when the window loses focus, or when the control moved, changed size, changed its name or is covered. It sends nothing more when the control removes itself in the middle of the press.
- `double-click-wait` optionally waits half a second. It sends nothing if a press or a key comes first, if the user presses inside an iframe or goes to another window, if the page changes or starts to leave, or if retargeting is turned off in the meantime.
- `wrong-report` records a wrong click as a wrong review mark and turns retargeting off when the rules say so. A wrong mark on the Review tab for a sent click counts the same, once a click.
- `decision-version` keeps a page from acting under a decision the gates have not passed with.
- `badge` marks the toolbar button on that tab for a moment after a click is sent on.
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
- **Other cases.** `npx playwright test e2e/retarget.spec.ts` covers every control type on the fixture, pages that only trust real input, popups, file pickers, each reason a click is not sent, the double-click wait, held fires, the reports, and each way the gates stop passing while retargeting is on.

## Gotchas

- The drive seeds the log with `heyo.importLog`, lets retargeting act on the fixture host with `heyo.allowTestHosts` and sets the held share to 0 with `heyo.holdTestShare`. All three are test hooks on the service worker. A user reaches a passing log only by browsing and reviewing, and has no way to add a site.
- The decision needs the cursor to have moved in the 300 ms before the press. A drive that clicks without moving the mouse first gets no fire.
- Two presses within half a second and 5 px are a double-click to heyo, also when a test sends them as two separate clicks. A test that wants two separate near misses in one spot has to wait longer or move away.
- heyo watches a sent click for 400 ms before it logs the outcome. Read the log at least 600 ms after a near miss.
- A popup or a new tab takes focus from a real window, which heyo counts as a reaction. A Playwright window keeps focus, so `reacted` is false there.
- A fire is `failed` with `second-press` when the user presses again within the first click's 50 ms settle time. The test sends the retry without waiting for the first click's answer, so it lands inside that time.
- With the double-click wait on, any change to the page during the wait stops the click. To test a control that moves during the wait, move it by a style rule, as `replay.html?move` does. A script that sets its style counts as the page reacting, and the fire is logged as `reacted`, not `moved`.
- The review page's marks and its delete go through the service worker. A test that makes the store fail has to break it in the worker, not in the page.
