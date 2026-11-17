# Scoring a log

The offline scorer runs a decision module over an exported log and reports the numbers the plan steers by. It needs Node 22 or later and `npm ci`.

## Get a log

- From the extension: open the review page, choose `Numbers`, then `Export the log`. That saves `heyo-log-<date>.json`.
- Synthetic, for trying things out: `npm run synth -- --out synth.json`.

Several exports can be scored together. Records and review marks that appear in more than one file are counted once.

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

The scorer runs the decision in a separate process with Node's permission system on. That process can read its own code and nothing else. It has no network and cannot start other processes. It is sent each click's features and returns a decision. It is never sent a site, a time, a record id, a follow-up or a review mark, so a decision cannot key on any of them.

A decision that returns anything other than a refusal or a logged control fails the run.

## The synthetic log

`npm run synth` simulates one person clicking through made-up sites for 12 weeks. Because the generator knows what every click was for, it writes a review mark for every candidate of every record. That stands in for the hand review.

Every number in `ASSUMPTIONS` in `synth/generate.ts` is a guess about behavior. Two matter most:

- `spreadDivisor` sets how often an aimed click misses.
- `deliberateNearShare` sets how often a deliberate click on empty space lands right beside a control. The wrong-target rate on a synthetic log follows almost directly from it, and nobody has measured it.

A synthetic log shows that the pipeline works and gives the agent loop something to tune against. It says nothing about how often real people miss. Only a real log does.
