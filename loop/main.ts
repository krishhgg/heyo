// The agent loop. A coding agent edits a copy of the decision module in a
// workspace. After each round this runner lints the copy, scores it on the
// train split with the scorer the agent cannot edit, and keeps it only if it
// is better. The held-out split is judged once, at the end, and never enters
// the workspace.
import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { retargetGates, wrongTargetGate } from '../src/core/gates';
import type { Score } from '../src/core/metrics';
import type { LogExport } from '../src/core/types';
import { loadLogs, scoreSplit, type Tools } from '../scorer/main';
import { splitter } from '../scorer/split';
import { decisionFiles, lintDecision, type Problem } from './lint';

const USAGE = `usage:
  lint <decision dir>
      Check a decision module against the loop's rules.
  run --log <log.json> [--log <more.json>] --agent "<command>"
      [--rounds <n>] [--minutes <n>] [--workspace <dir>] [--decision <dir>] [--apply] [--no-sandbox]
      Run the agent command once per round in a fresh workspace and keep each
      change that scores better on the train split. --apply copies the best
      decision into src/decision when it passes both held-out gates.`;

export interface LoopTools extends Tools {
  /** True when macOS sandbox-exec is available to confine the agent. */
  canSandbox: boolean;
}

/** How one decision did on the train split. */
export interface Standing {
  score: Score;
  /** The verified wrong-target gate passes on the train split. */
  underCeiling: boolean;
}

function standingOf(score: Score): Standing {
  return { score, underCeiling: wrongTargetGate(score).status === 'pass' };
}

/**
 * True when `next` is better than `best`. Getting under the wrong-target
 * ceiling comes first. Above it, a lower bound on the wrong-target rate is
 * better. Under it, higher recovery is better.
 */
export function isBetter(next: Standing, best: Standing): boolean {
  if (next.underCeiling !== best.underCeiling) return next.underCeiling;
  if (!next.underCeiling) return (next.score.wrongUpper ?? 1) < (best.score.wrongUpper ?? 1);
  return (next.score.recovery ?? 0) > (best.score.recovery ?? 0);
}

function percent(value: number | null, digits = 1): string {
  return value === null ? 'none' : `${(100 * value).toFixed(digits)}%`;
}

function describe(standing: Standing): string {
  const s = standing.score;
  return (
    `recovery ${percent(s.recovery)} (${s.recovered} of ${s.misses} misses), ` +
    `${s.wrong} wrong in ${s.reviewed} reviewed fires, upper bound ${percent(s.wrongUpper, 2)}, ` +
    `${standing.underCeiling ? 'under' : 'not under'} the 1% ceiling`
  );
}

function task(rounds: number): string {
  return `# Improve heyo's decision

heyo sends a mouse click that landed on empty space to the nearby control the
user aimed for. \`decision/index.ts\` exports \`decide(features)\`, which picks a
target or refuses. Make it better.

## What better means

1. First get under the ceiling. Of the clicks the decision would retarget, the
   share with the wrong target must have a 95% upper bound under 1%.
2. Then raise recovery, the share of labeled misses where the decision picks
   the control the user went on to click. The target is 50% or more.

A change is kept only if it is better by that order. Otherwise it is undone
before the next round. You have ${rounds} rounds in total. \`history.md\` lists what
happened in each.

## What you may do

- Edit files in \`decision/\` only. \`index.ts\` must export \`decide\`.
- Read \`core/types.ts\` and \`core/geometry.ts\` to see what a click's features
  hold. Editing them changes nothing. The scorer uses its own copies.
- Read \`train.json\`, the log you tune on. Its \`reviews\` say which candidate
  was right for each click.
- Run \`./score\` to score \`decision/\` on the train log.
- Run \`./lint\` to check \`decision/\` against the rules below.

## Rules the lint enforces

- \`decide\` is a pure function of its argument. No I/O, time or randomness.
- No hostnames, selectors, URLs or paths.
- No constants fitted to single examples. Numbers have at most 3 significant
  digits. Strings are short lower-case keywords.
- The module stays under 400 lines.

A separate held-out log, which you cannot see, decides whether the result ships.
A rule that only fits the train log will fail there.
`;
}

/** A seatbelt profile that hides the logs and makes the repo and the runner's folder read-only. */
function sandboxProfile(hidden: string[], readOnly: string[], privateDir: string): string {
  const quote = (path: string) => `"${path.replace(/(["\\])/g, '\\$1')}"`;
  return [
    '(version 1)',
    '(allow default)',
    ...hidden.map((path) => `(deny file-read* (literal ${quote(path)}))`),
    `(deny file-read* (subpath ${quote(privateDir)}))`,
    `(deny file-write* (subpath ${quote(privateDir)}))`,
    ...readOnly.map((path) => `(deny file-write* (subpath ${quote(path)}))`),
  ].join('\n');
}

function runAgent(
  command: string,
  cwd: string,
  profile: string | null,
  timeoutMs: number,
): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((done) => {
    const [file, args] = profile
      ? ['/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c', command]]
      : ['/bin/sh', ['-c', command]];
    const child = spawn(file, args, { cwd, stdio: 'inherit' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, timedOut });
    });
    child.on('error', () => {
      clearTimeout(timer);
      done({ code: 127, timedOut });
    });
  });
}

/** Copies a decision module's source files, without tests, into an empty folder. */
async function copyDecision(from: string, to: string): Promise<void> {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  for (const file of decisionFiles(from)) {
    const target = join(to, file.slice(from.length + 1));
    await mkdir(join(target, '..'), { recursive: true });
    await cp(file, target);
  }
}

function problemsText(problems: Problem[]): string {
  return problems.map((p) => `  ${p.file}:${p.line} ${p.message}`).join('\n');
}

function lintCommand(dir: string | undefined, tools: LoopTools): number {
  if (!dir) throw new Error('Give the decision folder to lint.');
  const problems = lintDecision(resolve(dir), join(tools.root, 'src/core'));
  if (problems.length === 0) {
    console.log('The decision passes the lint.');
    return 0;
  }
  console.log(`The decision breaks ${problems.length} rule${problems.length === 1 ? '' : 's'}:`);
  console.log(problemsText(problems));
  return 1;
}

interface RunOptions {
  logs: string[];
  agent: string;
  rounds: number;
  minutes: number;
  workspace: string;
  decision: string;
  apply: boolean;
  sandbox: boolean;
}

function parseRun(argv: string[], tools: LoopTools): RunOptions {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const options: RunOptions = {
    logs: [],
    agent: '',
    rounds: 5,
    minutes: 20,
    workspace: join(homedir(), 'agent-work', 'heyo-loop', stamp),
    decision: join(tools.root, 'src/decision'),
    apply: false,
    sandbox: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => argv[++i] ?? '';
    if (flag === '--log') options.logs.push(resolve(value()));
    else if (flag === '--agent') options.agent = value();
    else if (flag === '--rounds') options.rounds = Number(value());
    else if (flag === '--minutes') options.minutes = Number(value());
    else if (flag === '--workspace') options.workspace = resolve(value());
    else if (flag === '--decision') options.decision = resolve(value());
    else if (flag === '--apply') options.apply = true;
    else if (flag === '--no-sandbox') options.sandbox = false;
    else throw new Error(`Unknown option ${flag}.`);
  }
  if (options.logs.length === 0) throw new Error('Give at least one --log <log.json>.');
  if (!options.agent) throw new Error('Give --agent "<command>".');
  return options;
}

export interface LoopResult {
  rounds: { round: number; kept: boolean; note: string }[];
  train: Standing;
  /** The held-out gates for the best decision. */
  heldOut: ReturnType<typeof retargetGates>;
  best: string;
}

export async function runLoop(options: RunOptions, tools: LoopTools): Promise<LoopResult> {
  const coreDir = join(tools.root, 'src/core');
  const logs = await Promise.all(options.logs.map((file) => realpath(file)));
  const log = await loadLogs(logs);

  await mkdir(options.workspace, { recursive: true });
  const workspace = await realpath(options.workspace);
  const root = await realpath(tools.root);
  if (workspace.startsWith(root)) {
    throw new Error(
      'The workspace must be outside the repo, so the agent cannot reach the scorer.',
    );
  }
  // The runner's own folder sits beside the workspace. The sandbox hides it from the agent.
  const privateDir = `${workspace}.private`;
  const best = join(privateDir, 'best');
  await mkdir(privateDir, { recursive: true });

  const parts = splitter(log.records);
  const records = log.records.filter((record) => parts.of(record) === 'train');
  const ids = new Set(records.map((record) => record.id));
  const train: LogExport = {
    ...log,
    records,
    reviews: log.reviews.filter((review) => ids.has(review.recordId)),
  };

  const work = join(workspace, 'decision');
  await copyDecision(options.decision, work);
  await copyDecision(options.decision, best);
  await mkdir(join(workspace, 'core'), { recursive: true });
  for (const name of ['types.ts', 'geometry.ts']) {
    const copy = join(workspace, 'core', name);
    await rm(copy, { force: true });
    await cp(join(coreDir, name), copy);
    await chmod(copy, 0o444);
  }
  await writeFile(join(workspace, 'train.json'), `${JSON.stringify(train)}\n`);
  await writeFile(join(workspace, 'TASK.md'), task(options.rounds));
  const node = JSON.stringify(process.execPath);
  await writeFile(
    join(workspace, 'score'),
    `#!/bin/sh\nexec ${node} ${JSON.stringify(join(root, 'scorer/cli.mjs'))} score ${JSON.stringify(join(workspace, 'train.json'))} --decision ${JSON.stringify(work)} "$@"\n`,
  );
  await writeFile(
    join(workspace, 'lint'),
    `#!/bin/sh\nexec ${node} ${JSON.stringify(join(root, 'loop/cli.mjs'))} lint ${JSON.stringify(work)}\n`,
  );
  await chmod(join(workspace, 'score'), 0o755);
  await chmod(join(workspace, 'lint'), 0o755);

  const history = join(workspace, 'history.md');
  const note = async (line: string) => {
    console.log(line);
    const before = await readFile(history, 'utf8').catch(() => '# History\n\n');
    await writeFile(history, `${before}${line}\n`);
  };

  const standing = async (dir: string) =>
    standingOf((await scoreSplit(train, 'all', dir, tools)).score);

  let bestStanding = await standing(best);
  await note(`- Start: ${describe(bestStanding)}.`);

  const sandboxed = options.sandbox && tools.canSandbox;
  if (options.sandbox && !tools.canSandbox) {
    console.log('sandbox-exec is not available here. The agent runs without OS confinement.');
  }
  const profile = sandboxed ? sandboxProfile(logs, [root], privateDir) : null;

  const rounds: LoopResult['rounds'] = [];
  for (let round = 1; round <= options.rounds; round++) {
    const ran = await runAgent(options.agent, workspace, profile, options.minutes * 60_000);
    let kept = false;
    let line: string;
    const problems = lintDecision(work, coreDir);
    if (ran.timedOut) {
      line = `stopped after ${options.minutes} minutes`;
    } else if (problems.length > 0) {
      line = `rejected by the lint:\n${problemsText(problems)}`;
    } else {
      try {
        const next = await standing(work);
        kept = isBetter(next, bestStanding);
        line = `${kept ? 'kept' : 'not better, undone'}: ${describe(next)}`;
        if (kept) {
          bestStanding = next;
          await copyDecision(work, best);
        }
      } catch (error) {
        line = `could not be scored: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (!kept) await copyDecision(best, work);
    rounds.push({ round, kept, note: line });
    await note(`- Round ${round}: ${line}.`);
  }

  const heldOut = retargetGates((await scoreSplit(log, 'test', best, tools)).score);
  const result: LoopResult = { rounds, train: bestStanding, heldOut, best };
  await writeFile(join(privateDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

  console.log(`\nBest decision on the train split: ${describe(bestStanding)}.`);
  console.log(
    `Held-out gates: recovery ${heldOut.recovery.status} (${percent(heldOut.recovery.recovery)} of ${heldOut.recovery.misses} misses), ` +
      `wrong target ${heldOut.wrongTarget.status} (${heldOut.wrongTarget.wrong} wrong in ${heldOut.wrongTarget.reviewed}, ` +
      `upper bound ${percent(heldOut.wrongTarget.upper, 2)}).`,
  );
  console.log(`The best decision is in ${best}.`);
  if (options.apply && heldOut.pass) {
    for (const file of decisionFiles(best)) {
      await cp(file, join(tools.root, 'src/decision', file.slice(best.length + 1)));
    }
    console.log('Both held-out gates pass. Copied the best decision into src/decision.');
  } else if (options.apply) {
    console.log('A held-out gate did not pass. src/decision is unchanged.');
  }
  return result;
}

export async function main(argv: string[], tools: LoopTools): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'lint') return lintCommand(rest[0], tools);
    if (command === 'run') {
      const result = await runLoop(parseRun(rest, tools), tools);
      return result.heldOut.pass ? 0 : 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }
  console.log(USAGE);
  return 2;
}
