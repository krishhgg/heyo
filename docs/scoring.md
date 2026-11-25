# Scoring a log

The offline scorer runs a decision module over an exported log and reports the numbers the plan steers by. It needs Node 26 or later and `npm ci`. Earlier versions of Node cannot keep a locked-down process off the network, and the scorer checks for that and refuses to run on them.

## Get a log

- From the extension: open the review page, choose `Numbers`, then `Export the log`. That saves `heyo-log-<date>.json`.
- Synthetic, for trying things out: `npm run synth -- --out synth.json`.

Several exports can be scored together. Records and review marks that appear in more than one file are counted once. Where two exports hold the same record, the later export wins, whatever order the files are named in. Exports that share a record are taken as snapshots of one browser's log, and the later one's count of a day's clicks wins. Exports that share no record are taken as logs of different browsers, and their counts for a day are added. An export with no records is taken as an early snapshot of the one exported after it.

## Score it

```bash
npm run score -- heyo-log-2026-12-01.json                 # the whole log
npm run score -- heyo-log-2026-12-01.json --split train   # only the part used for tuning
npm run score -- a.json b.json --decision path/to/decision --json
```

The report shows labeled misses, recovery, would-be fires, how many fires were reviewed and how many were wrong, the 95% upper bound on the wrong-target rate, and how often the decision gave each answer.

## Judge the gates

```bash
npm run gates -- heyo-log-2026-12-01.json
```

This scores the held-out split and judges the two data gates in front of retargeting:

- Proxy recovery at least 50%, on at least 30 labeled misses.
- Verified wrong-target rate under 1%. The one-sided 95% upper bound has to be under 1%, which takes 299 reviewed fires with none wrong, or 473 with one wrong.

It also reports the shadow-mode stop condition on the whole log. The command exits 0 only when both retargeting gates pass. Too little evidence prints `NOT ENOUGH DATA`, which is not a pass.

## How the split works

A record is held out when its site is one of a fixed quarter of the sites, or when it falls in the last 30% of the weeks the log covers. Everything else is the train split. A rule tuned on train is judged on sites and weeks it has not seen. With a single week of data only the sites are split.

`npm run score -- log.json --split test` prints the held-out numbers. Look at them to judge a finished decision, not while tuning one.

## What the decision can see

The scorer runs the decision in a separate process with Node's permission system on. That process can read its own code and nothing else. It has no network, cannot start other processes, and gets an empty environment, so it sees none of the caller's variables. Every scoring runs the clicks twice, the second time in reverse order in a new process. A decision that answers the same click differently is refused, because it is keeping something from one click to the next. It is sent each click's features and returns a decision. It is never sent a site, a time, a record id, a follow-up or a review mark, so a decision cannot key on any of them.

A decision may import only its own `.ts` files and the repo's `src/core`. The scorer refuses to bundle anything else: a log file, a Node module, a file outside the decision's folder or a link that points out of it. Bundling happens before the locked-down process starts, so an import of a log would otherwise carry its review marks into the decision.

A decision that returns anything other than a refusal or a logged control fails the run.

## The synthetic log

`npm run synth` simulates one person clicking through made-up sites for 24 weeks. Because the generator knows what every click was for, it writes a review mark for every candidate of every record. That stands in for the hand review.

Every number in `ASSUMPTIONS` in `synth/generate.ts` is a guess about behavior. Four matter most:

- `spreadDivisor` sets how often an aimed click misses and how far, with `slipShare` for the rare wide miss. A click aimed at one control that lands nearer its neighbour is where most wrong fires come from, so this guess, together with how close the generator puts controls to each other, sets most of the wrong-target rate.
- `deliberateNearShare` sets how often a deliberate click on empty space lands right beside a control. It sets the rest of the wrong-target rate, and nobody has measured it.
- `deliberateResting` sets how many deliberate clicks come from a cursor at rest, and `dwellMedianMs` how long an aiming hand rests before it presses. The decision refuses a click from a still cursor, so these two set what that rule saves and what it costs.

Presses land on whole pixels, and a box's right and bottom edges are outside it, as in a browser. A corrective movement heads for the target.

A synthetic log shows that the pipeline works and gives the agent loop something to tune against. It says nothing about how often real people miss. Only a real log does.

## The scripted log

`npm run scripted` takes the clicks the generator plans and plays them with a real mouse through the built extension. Each scene is drawn as real elements on a fixture page, the pointer follows the planned path in real time, and the extension logs what it measures. The result is a log like any other, with a review mark for every candidate, written from what each click was planned for.

```bash
npm run build
npm run scripted -- --out scripted.json                 # 24 weeks, 10 to 25 minutes
npm run scripted -- --out scripted.json --seed 2 --workers 12
npm run gates -- scripted.json
```

It plays every planned click that lands on empty space within 30 px of a control, about 8,800 of 134,400. It also plays 2% of the others, and it counts the rest as the generator counted them, so the miss rate is that of the whole simulated stretch.

The summary it prints is a check on the capture code:

- `Records the extension logged` against the clicks played.
- `Clicks beside a control that left no record`, split into the two cases where that is right and the unexplained ones, which are bugs.
- `Retries on the target that the log attached to the miss`.
- `Nearest control the same as the generator simulated`.

The scripted log has the same limit as the synthetic one. Its clicks come from the same guesses about behavior, so it says nothing about how often real people miss. What it adds is that every feature in it was measured by the real extension in a real browser.

## The practice log

`npm run practice` opens a page for a person to click through, in Playwright's Chromium with the built extension and a fresh profile. One control at a time turns yellow, and the person clicks it as fast as they can. The page logs every press and which control was lit. heyo logs what it logs on any site. At the end the run puts the two together and writes heyo's log with a review mark on every candidate: right for the lit control, wrong for any other.

```bash
npm run build
npm run practice -- --out practice-1.json                # 240 hits, about 8 minutes
npm run practice -- --out practice-2.json --trials 60
npm run score -- practice-1.json practice-2.json
```

It needs Playwright's Chromium (`npx playwright install chromium`). The window closes by itself at the end. **Finish now**, at the top of the page, stops early and keeps what was done. A window closed by hand keeps heyo's log as of the last tenth hit.

The page has five scenes copied from common layouts. They are a mail list, a project page, an article with inline links and footnotes, a settings list and a calendar. The project page has tabs, a file table and page numbers. Controls sit 2 to 10 px apart, as on real pages.

What a practice log shows:

- How often the decision picks a control other than the one the person aimed at, on misses a person made. Every fire is marked, so the count needs no hand review.
- Whether the retry label points at the control the person meant. The summary counts the labeled misses whose retry landed on the lit control.

What it does not show:

- How often people miss. The page asks for speed and lights small controls, so misses come far more often than in everyday browsing. A person who knows where the target is and is told to hurry also aims differently from one who is browsing. The marks are true for these clicks, so a wrong-target rate from them checks the decision. It does not measure the decision in everyday use.
- Wrong fires on deliberate clicks on empty space. Every press on the page is aimed at the lit control.

Score a practice log with `npm run score`, not `npm run gates`. All its records come from one site, `practice.heyo.test`, and the held-out split is drawn by site, so the gates would see either all of a practice log or none of it.

The summary the run prints:

- `Presses`, split into presses on the lit control, on another control and on neither.
- `Records heyo logged`, and how many matched a press on the page. A record from the start screen matches none and is left out.
- `Records with the lit control among the candidates`. In the others heyo did not list the lit control, for example because the press was more than 30 px from it.
- `Fires by the decision in this build`, and how many went to the lit control.
- `Labeled misses`, and how many were retried on the lit control.
