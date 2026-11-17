# Review and numbers

The toolbar button opens the review page. It shows each click heyo would have retargeted as a drawing to scale, and the user marks it right, wrong or not sure. A second tab shows the numbers behind the plan's gates and exports or deletes the log.

## Sub-features

- `open` opens the review page from the toolbar button, or switches to it when it is already open.
- `mark` stores a right, wrong or not-sure mark from the keyboard (`Y`, `N`, `U`) or the buttons.
- `back` returns to the last marked click (`Z`) so its mark can change.
- `order` shows fires in a fixed random order and never shows a refused click or whether the user retried.
- `numbers` shows the miss rate, recovery, the wrong-target bound and each gate's status.
- `export` downloads the whole log as `heyo-log-<date>.json`.
- `delete` clears the log after a second, explicit click. A double-click on the first button lands on `Keep the log`.

## How to get to it (user POV)

- Click the heyo button in Chrome's toolbar.
- Press `Y`, `N`, `U` or `Z`, or click the buttons.
- Choose `Numbers`, then `Export the log` or `Delete the log`.

## Driving it with verify.mjs

Preconditions:

- `npm run build` has run.

- **Whole flow.** Run `npm run verify -- run review-flow`. The drive makes five near misses on `app.html`, opens the review page through the service worker's `openReview` (the same call the toolbar button makes), marks three fires with `Y`, `N` and `U`, goes back with `Z` and changes one mark, opens `Numbers` and exports. The transcript ends with `stored marks: {...}` matching what was pressed, then `PASS review-flow`.
- **Proof.** `1-review.png` is the first fire, `2-stamp.png` the stamp after `Y`, `3-numbers.png` the numbers tab. `export.json` is the downloaded file. `result.json` is the log read back from the service worker, and the drive asserts both hold the same records.
- **A GIF for a pull request.** Run the drive with `--video`, then `.claude/skills/verify-heyo/scripts/to-gif.sh <evidence folder>`. It writes one `.gif` beside each `.webm`.
- **Other cases.** `npx playwright test e2e/review.spec.ts` covers the empty state, the blind review, the numbers and the delete confirmation.

## Gotchas

- Playwright cannot click Chrome's toolbar. The drive calls `heyo.openReview()` in the service worker, which is the function the toolbar button's listener calls.
- Keys are ignored while the verdict stamp shows and for 300 ms after the next click comes up. Wait for `.verdicts[aria-busy="false"]`, or for `.empty` after the last click, before the next key.
- The review order is a hash of the record id, so which fire comes first differs between runs. Read the target's name from `.target` instead of assuming an order.
- The review screen shows only how many fires are marked and how many wait. The count the gate needs, the wrong marks and the not-sure marks are on the `Numbers` tab, where it reads `299 with this many wrong` with none wrong and `473` after one.
- The delete button ignores clicks for 600 ms after it appears, and Playwright waits that out. A test of an early click passes `force: true`.
- A changed mark replaces the old one. The drive asserts that the exported marks equal the stored ones.
