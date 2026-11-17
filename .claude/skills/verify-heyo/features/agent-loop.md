# Agent loop

`npm run loop` runs a coding agent against a log to improve the decision module. The agent works in a workspace that holds a copy of the decision and the train split. The runner lints and scores each round and keeps only better changes.

## Sub-features

- `workspace` gives the agent the decision, the train split, the task and the `./score` and `./lint` commands, and nothing from the held-out split.
- `keep-or-undo` keeps a change that is better and restores the last best decision otherwise.
- `lint` rejects hostnames, selectors, constants fitted to examples, and anything impure.
- `sandbox` stops the agent from reading the log or writing to the repo, on macOS.
- `held-out` judges the best decision on the held-out split once, at the end.

## How to get to it (user POV)

- Run `npm run loop -- --log <file> --agent "<command>"` in the repo.
- Run `npm run lint:decision` to lint `src/decision`.

## Driving it with verify.mjs

Preconditions:

- `npm ci` has run. No build is needed. The drive opens a browser it does not use.

- **Two rounds with a scripted agent.** Run `npm run verify -- run agent-loop`. The drive writes a 42-day synthetic log and runs the loop for two rounds with a script as the agent. Round 1 adds a rule that makes the decision better. Round 2 loosens a constant, which is worse. The transcript shows the loop's own output, then `PASS agent-loop`. The drive asserts that history says `Round 1: kept` and `Round 2: not better, undone`, that the workspace decision has round 1's change and not round 2's, that `train.json` holds fewer records than the log, and on macOS that the script's attempts to read the log and append to `scorer/main.ts` both failed with `EPERM`.
- **Proof.** `loop-output.txt` is what the loop printed, `history.md` the per-round record, and `result.json` the runner's final result with the held-out gates.
- **A real agent.** `docs/agent-loop.md` has the command. A real run takes minutes per round and is not part of this drive.
- **Other cases.** `npx vitest run loop` covers each lint rule and the loop's keep-or-undo order.

## Gotchas

- The workspace must be outside the repo. The runner refuses otherwise.
- The runner's own folder is `<workspace>.private`. The best decision and `result.json` are there, not in the workspace.
- The sandbox denies reads of the exact log files passed with `--log`. A copy of a log elsewhere on disk is not protected.
- On Linux the sandbox tests are skipped and the drive says so.
