# The agent loop

The decision is a pure function in `src/decision`. The loop lets a coding agent improve it against a log, without being able to edit the scorer or see the data that judges the result.

## Run it

```bash
npm run loop -- --log heyo-log.json --agent "<command>" --rounds 5
```

`--agent` is any shell command that starts a coding agent non-interactively. It runs once per round with the workspace as its working directory. For example:

```bash
npm run loop -- --log ~/Downloads/heyo-log-2026-12-01.json --rounds 5 \
  --agent 'claude -p "Read TASK.md in this folder and do what it says." --permission-mode acceptEdits'
```

Options:

- `--log <file>` can be given more than once.
- `--rounds <n>` is the number of agent runs. The default is 5.
- `--minutes <n>` is the time limit for one round. The default is 20.
- `--workspace <dir>` is where the agent works. The default is a new folder under `~/agent-work/heyo-loop/`. It must be outside the repo.
- `--decision <dir>` is the decision to start from. The default is `src/decision`.
- `--apply` copies the best decision into `src/decision` if it passes both held-out gates.
- `--no-sandbox` runs the agent without OS confinement. Use it only where `sandbox-exec` does not exist.

The command exits 0 when the best decision passes both held-out gates.

## What the agent gets

The workspace holds:

- `decision/`, a copy of the decision module. This is the only thing the agent's edits affect.
- `train.json`, the train split of the log, with its review marks.
- `core/types.ts` and `core/geometry.ts`, read-only copies for reference. The scorer uses the repo's own.
- `TASK.md`, the instructions.
- `./score`, which scores `decision/` on the train split, and `./lint`, which checks it against the rules.
- `history.md`, what happened in each round so far.

## What keeps the result honest

- **The scorer is out of reach.** The agent runs under macOS `sandbox-exec`. Everything the runner runs code from is read-only to it: the repo, the packages the repo depends on (also when they sit outside the repo behind a link) and Node itself. The folder the runner writes worker code into before running it is closed to the agent for reads and writes. It can run the scorer but not change it.
- **The held-out split never enters the workspace.** The sandbox denies reads of the log files and of the runner's own folder. The runner judges the held-out split once, after the last round, and prints the result for you. The agent is never told it.
- **The ceiling comes first.** A change is kept only if it is better, in this order: getting the verified wrong-target rate under the 1% ceiling, then a lower bound on that rate while above the ceiling, then higher recovery once under it. Anything else is undone before the next round.
- **The lint rejects rules fitted to examples.** No hostnames, selectors, URLs or paths. Numbers have at most 3 significant digits. Strings are short lower-case keywords. No I/O, time or randomness. The module stays under 400 lines. `npm run lint:decision` runs the same lint on `src/decision`, and CI runs it too.
- **The decision cannot see labels.** The scorer runs it in a process that is sent click features and nothing else. See [scoring.md](scoring.md).

On Linux there is no `sandbox-exec`. The loop still runs with `--no-sandbox`, and the lint and the scorer's isolation still apply, but nothing stops the agent from reading the log file.

## When to run it

The plan says to start the loop after about 500 labeled misses. With fewer, a rule can fit the log by chance. `npm run score -- <log>` shows how many the log holds.

## After a run

The best decision is in `<workspace>.private/best`, with `result.json` beside it. Read the diff against `src/decision` before using it. A rule that passes the gates can still be one you do not want.
