# Practice run

`npm run practice` opens a page in Playwright's Chromium, with the built extension and a fresh profile, for a person to click through. One control at a time turns yellow, and the person clicks it as fast as they can. The run matches each record heyo logged to the press the page logged, marks every candidate right or wrong from the lit control, and writes heyo's log with those marks.

## Sub-features

- `page` lights one control at a time in one of five scenes, logs every press on the stage, and hands its log to the run after each hit and at the end.
- `join` matches records to presses by time and point, keeps the matched records, and writes a review mark for every control candidate.
- `copies` takes heyo's log every tenth hit, so a window closed by hand still leaves a log.
- `summary` prints where presses landed, how many records matched, the fires and whether they went to the lit control, and how the retry label agreed with it.

## How to get to it (user POV)

- Run `npm run build`, then `npm run practice -- --out practice.json`.
- Click Start in the window, click the yellow controls, and let the window close itself.
- Run `npm run score -- practice.json`.

## Driving it with verify.mjs

Preconditions:

- `npm run build` has run.

- **The whole run.** `npx playwright test e2e/practice.spec.ts` plays eight hits with a scripted mouse that misses each lit control by 3 px on its clearest side before clicking it. It checks that every miss left one record, that every record matched a press, that each fire went to the lit control, and that every candidate has a mark. The written log is the proof. Every record in it came from the extension's service worker.
- **The join.** `npx vitest run practice` covers matching by time and point, the marks and the counts.
- **A person.** `npm run practice -- --trials 10 --out .verify/practice.json` opens a real window. It needs someone at the mouse, so no drive runs it.
- **The scenes.** The page's functions are global, so a screenshot script can call `show(n)` after clicking Start and wait 400 ms for a control to light.

## Gotchas

- The page is served as `practice.heyo.test` on a free port. Only the browsers the run starts resolve that name.
- No press changes the page's DOM. The lit control and the count are two rules in the `#cue` style sheet, so find the lit control with that sheet's first rule, not a class. A new scene does change the DOM, and nothing is lit for 400 ms after it.
- A record that matches no press is left out. Presses off the stage, such as on Start or Finish now, are not logged.
- Score a practice log with `npm run score`. `npm run gates` splits by site, and every practice record is on one site.
