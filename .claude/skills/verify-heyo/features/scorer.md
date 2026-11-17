# Scorer

`npm run score` and `npm run gates` run a decision module over an exported log and report recovery, the wrong-target bound and the plan's gates. `npm run synth` writes a synthetic log to try them on.

## Sub-features

- `score` reports the metrics for the whole log or one split.
- `gates` judges the two retargeting gates on the held-out split and exits 0 only when both pass.
- `split` holds out a quarter of the sites and the last 30% of the weeks.
- `isolation` runs the decision in a process that cannot read files, use the network or start processes, and is sent only click features.
- `synth` generates a seeded synthetic log with ground-truth review marks.

## How to get to it (user POV)

- Export a log from the review page's `Numbers` tab.
- Run `npm run score -- <file>` or `npm run gates -- <file>` in the repo.

## Driving it with verify.mjs

Preconditions:

- `npm run build` has run.

- **From the browser to the scorer.** Run `npm run verify -- run scorer`. The drive misses three controls on `app.html` and retries each, makes one more empty-space click, marks every would-be fire right in the review page, exports the log, and runs `scorer/cli.mjs score` on the downloaded file. The transcript shows the scorer's report, then `PASS scorer`. The drive asserts 4 records, 3 labeled misses, 3 recovered and no wrong fires.
- **Proof.** `export.json` is the downloaded log. `score.txt` is the scorer's report on it and `result.json` the same numbers as JSON.
- **Gates on synthetic data.** Run `npm run synth -- --out .verify/synth.json` then `npm run gates -- .verify/synth.json`. The report ends with `Both retargeting gates pass.` or `Retargeting stays off. A gate did not pass.`, and the exit code matches.
- **Other cases.** `npx vitest run scorer synth` covers the split, a decision that tries to read files or open a connection, a decision that picks a control that was not logged, and the generator.

## Gotchas

- The scorer bundles TypeScript with esbuild on each run, so it needs `npm ci` but no build.
- `gates` scores the held-out split only. On a log that covers one week, that is a quarter of the sites and can be empty.
- The synthetic log's review marks come from the generator's own knowledge of what each click was for. They are not hand reviews.
- A decision folder must have an `index.ts` that exports `decide`.
