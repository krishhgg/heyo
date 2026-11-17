// The agent loop. A coding agent edits a copy of the decision module in a
// workspace. After each round this runner lints the copy, scores it on the
// train split with the scorer the agent cannot edit, and keeps it only if it
// is better. The held-out split is judged once, at the end, and never enters
// the workspace.
import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
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
  /**
   * Folders the runner writes code into and then runs, such as its bundle
   * cache. The agent may neither read nor write them.
   */
  privateDirs: string[];
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

- \`decide\` is a pure function of its argument. No I/O, time or randomness, and nothing kept from one click to the next. The scorer runs the clicks in two orders and refuses a decision whose answers differ.
- No hostnames, selectors, URLs or paths.
- No constants fitted to single examples. Numbers have at most 3 significant
  digits. Strings are short lower-case keywords.
- The module stays under 400 lines.

A separate held-out log, which you cannot see, decides whether the result ships.
A rule that only fits the train log will fail there.
`;
}

/**
 * A seatbelt profile for the agent. It closes the logs and the runner's own
 * folders to reads and writes, and it makes read-only everything the runner
 * loads code from.
 */
export function sandboxProfile(hidden: string[], readOnly: string[], priv: string[]): string {
  const quote = (path: string) => `"${path.replace(/(["\\])/g, '\\$1')}"`;
  // Every run keeps its held-out result in a folder whose name ends in
  // .private. An earlier run's folder is as closed to the agent as this run's.
  const anyPrivate = String.raw`(regex #"\.private(/|$)")`;
  return [
    '(version 1)',
    '(allow default)',
    ...hidden.map((path) => `(deny file-read* (literal ${quote(path)}))`),
    // The log is the user's export. The agent may not change, move or remove it either.
    ...hidden.map((path) => `(deny file-write* (literal ${quote(path)}))`),
    `(deny file-read* ${anyPrivate})`,
    `(deny file-write* ${anyPrivate})`,
    ...priv.map((path) => `(deny file-read* (subpath ${quote(path)}))`),
    ...priv.map((path) => `(deny file-write* (subpath ${quote(path)}))`),
    ...readOnly.map((path) => `(deny file-write* (subpath ${quote(path)}))`),
  ].join('\n');
}

/**
 * Everything the runner runs code from, by real path: the repo, the packages
 * it depends on, which can sit outside the repo behind a link, and Node itself.
 * The agent can write none of it, or it could change how its own work is scored.
 */
/** True when a path is a folder or lies in it. A sibling whose name starts the same way does not. */
export function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + sep);
}

export async function codePaths(root: string): Promise<string[]> {
  const paths = [root, dirname(await realpath(process.execPath))];
  const packages = await realpath(join(root, 'node_modules')).catch(() => null);
  if (packages && !isInside(packages, root)) paths.push(packages);
  return paths;
}

/** True while any process of a group is alive. */
function groupAlive(group: number): boolean {
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the agent command and waits until everything it started is gone. The
 * agent gets a process group of its own, and the whole group is killed when
 * the time is up and when the command returns. A process the agent left
 * behind could otherwise go on editing the decision while it is being judged.
 */
export function runAgent(
  command: string,
  cwd: string,
  profile: string | null,
  timeoutMs: number,
): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((done) => {
    const [file, args] = profile
      ? ['/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c', command]]
      : ['/bin/sh', ['-c', command]];
    const child = spawn(file, args, { cwd, stdio: 'inherit', detached: true });
    const group = child.pid;
    const killGroup = () => {
      try {
        if (group !== undefined) process.kill(-group, 'SIGKILL');
      } catch {
        // The group is already gone.
      }
    };
    // The group no longer gets the terminal's Ctrl-C, so pass a stop on.
    const onStop = () => {
      killGroup();
      process.exit(130);
    };
    process.once('SIGINT', onStop);
    process.once('SIGTERM', onStop);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    const finish = async (code: number | null) => {
      clearTimeout(timer);
      killGroup();
      // A killed process takes a moment to go. Nothing is judged before it has.
      for (let i = 0; group !== undefined && groupAlive(group) && i < 100; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      process.off('SIGINT', onStop);
      process.off('SIGTERM', onStop);
      done({ code, timedOut });
    };
    child.on('close', (code) => void finish(code));
    child.on('error', () => void finish(127));
  });
}

/**
 * Writes a file of the runner's into the workspace, in place of whatever is
 * there. An agent can leave a link under any name, and a plain write would
 * follow it out of the workspace. The old entry is removed, link or not, and
 * the new file is created only if nothing is in its place.
 */
async function writeFresh(path: string, text: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await writeFile(path, text, { flag: 'wx' });
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

/**
 * Makes the decision in an existing folder the same as the one in `from`:
 * copies its source files over, and removes source files it no longer has.
 * A helper the winner dropped would otherwise stay and be shipped with it.
 * Anything that is not a decision source, such as the folder's tests, is left alone.
 */
export async function copyInto(from: string, to: string): Promise<void> {
  const targets = decisionFiles(from).map((file) => ({
    file,
    target: join(to, file.slice(from.length + 1)),
  }));
  const kept = new Set(targets.map(({ target }) => target));
  for (const old of decisionFiles(to)) if (!kept.has(old)) await rm(old);
  // Every folder first, so a copy cannot fail halfway through on a missing one.
  for (const { target } of targets) await mkdir(dirname(target), { recursive: true });
  for (const { file, target } of targets) await cp(file, target);
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
  if (isInside(workspace, root)) {
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
    // The day counts name every site and day, the held-out ones too, and scoring does not use them.
    counts: [],
  };

  const work = join(workspace, 'decision');
  await copyDecision(options.decision, work);
  await copyDecision(options.decision, best);
  // A workspace can be one an earlier agent worked in, so nothing in it is
  // written through. Each entry of the runner's is removed and made again.
  await rm(join(workspace, 'core'), { recursive: true, force: true });
  await mkdir(join(workspace, 'core'));
  for (const name of ['types.ts', 'geometry.ts']) {
    const copy = join(workspace, 'core', name);
    await cp(join(coreDir, name), copy);
    await chmod(copy, 0o444);
  }
  await writeFresh(join(workspace, 'train.json'), `${JSON.stringify(train)}\n`);
  await writeFresh(join(workspace, 'TASK.md'), task(options.rounds));
  const node = JSON.stringify(process.execPath);
  await writeFresh(
    join(workspace, 'score'),
    `#!/bin/sh\nexec ${node} ${JSON.stringify(join(root, 'scorer/cli.mjs'))} score ${JSON.stringify(join(workspace, 'train.json'))} --decision ${JSON.stringify(work)} "$@"\n`,
  );
  await writeFresh(
    join(workspace, 'lint'),
    `#!/bin/sh\nexec ${node} ${JSON.stringify(join(root, 'loop/cli.mjs'))} lint ${JSON.stringify(work)}\n`,
  );
  await chmod(join(workspace, 'score'), 0o755);
  await chmod(join(workspace, 'lint'), 0o755);

  // The runner keeps the history itself and writes the agent a new copy each
  // time, so nothing the agent did to its copy is read back or written through.
  let history = '# History\n\n';
  const note = async (line: string) => {
    console.log(line);
    history += `${line}\n`;
    await writeFresh(join(workspace, 'history.md'), history);
  };

  const standing = async (dir: string) =>
    standingOf((await scoreSplit(train, 'all', dir, tools)).score);

  let bestStanding = await standing(best);
  await note(`- Start: ${describe(bestStanding)}.`);

  const sandboxed = options.sandbox && tools.canSandbox;
  if (options.sandbox && !tools.canSandbox) {
    console.log('sandbox-exec is not available here. The agent runs without OS confinement.');
  }
  const profile = sandboxed
    ? sandboxProfile(logs, await codePaths(root), [
        privateDir,
        ...(await Promise.all(tools.privateDirs.map((path) => realpath(path)))),
      ])
    : null;

  const rounds: LoopResult['rounds'] = [];
  for (let round = 1; round <= options.rounds; round++) {
    const ran = await runAgent(options.agent, workspace, profile, options.minutes * 60_000);
    let kept = false;
    let line: string;
    // An agent can leave the folder in any state, gone included. That is a
    // rejected round like any other, and the best decision is put back.
    let problems: Problem[] = [];
    let unreadable: string | null = null;
    try {
      problems = lintDecision(work, coreDir);
    } catch (error) {
      unreadable = error instanceof Error ? error.message : String(error);
    }
    if (ran.timedOut) {
      line = `stopped after ${options.minutes} minutes`;
    } else if (unreadable !== null) {
      line = `could not be read: ${unreadable}`;
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
    await copyInto(best, join(tools.root, 'src/decision'));
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
