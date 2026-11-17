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

Every number in `ASSUMPTIONS` in `synth/generate.ts` is a guess about behavior. Two matter most:

- `spreadDivisor` sets how often an aimed click misses.
- `deliberateNearShare` sets how often a deliberate click on empty space lands right beside a control. The wrong-target rate on a synthetic log follows almost directly from it, and nobody has measured it.

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
