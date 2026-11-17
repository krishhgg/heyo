# Scripted run

`npm run scripted` takes the clicks the synthetic generator plans and plays them with a real mouse through the built extension, on fixture pages that draw each scene as real elements. The extension logs them as it would log a person's clicks. The run adds a review mark for every logged candidate from what it knows each click was for, and writes one log that `npm run gates` judges like any other.

## Sub-features

- `schedule` picks the clicks to play: every planned click that lands on empty space within 30 px of a control, and a 2% sample of the rest.
- `play` draws the scene, moves the pointer along the planned path in real time, presses, and makes the planned second press.
- `marks` writes a review mark per logged candidate: right for the control the click was aimed at, wrong for any other.
- `days` moves each simulated day back to its place, so the log spans the weeks it simulates.
- `checks` compares each record with what the generator simulated for the same click.

## How to get to it (user POV)

- Run `npm run build`, then `npm run scripted -- --out scripted.json`.
- Run `npm run gates -- scripted.json`.

## Driving it with verify.mjs

Preconditions:

- `npm run build` has run.
- Nothing rebuilds `dist/` or edits `e2e/fixtures/scripted.html` while a run is going.

- **A short run.** Run `npm run scripted -- --days 2 --workers 2 --out .verify/scripted.json`. It takes under a minute. With the default seed the summary shows `Records the extension logged: 53`, `from clicks planned as plain: 0`, `0 in between`, `Retries on the target that the log attached to the miss: 30 of 30 (100.0%)` and `Nearest control the same as the generator simulated: 50 of 50 (100.0%)`.
- **Score it.** Run `npm run score -- .verify/scripted.json`. The report shows labeled misses, recovery and the decisions made on features the real extension measured.
- **The full run.** Run `npm run scripted -- --out .verify/scripted-full.json --workers 12`, then `npm run gates -- .verify/scripted-full.json`. It plays 24 weeks and takes 10 to 25 minutes. The gates report ends with `Both retargeting gates pass.` or `Retargeting stays off. A gate did not pass.`, and the exit code matches.
- **Proof.** The written log is the proof. Every record in it came from the extension's service worker.
- **Other cases.** `npx playwright test e2e/scripted.spec.ts` plays one short day and asserts the checks. `npx vitest run scripted` covers the schedule, the marks and the day shift.

## Gotchas

- The browsers load `dist/extension` and the fixture server reads `e2e/fixtures/` as it goes. A rebuild or a branch switch in the middle of a run corrupts it.
- The pointer path and the wait before a retry are played in real time, so a click takes about a second however fast the machine is. The browsers mostly wait, so more workers than cores is fine.
- A press planned within 1 px outside a control's edge often lands on the control in a real browser. A control whose nearest corner is 27 to 30 px away can fall between the search's outer sample points. The summary counts both apart. A click in between that leaves no record is a bug, and the summary lists each one.
- Clicks planned into a window without focus are counted but not played. A page under test always has focus.
- The log's timestamps are moved back by whole days after the fact. The extension stamps clicks with the real clock.
- The clicks that are not played are added to the day counts as the generator counted them, so the miss rate is that of the whole simulated stretch.
