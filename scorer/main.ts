// The offline scorer. It runs a decision module over an exported log and
// reports the plan's numbers and gates.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dayOf } from '../src/core/days';
import { missRateGate, retargetGates, type GateStatus } from '../src/core/gates';
import { missRate, score, type Score } from '../src/core/metrics';
import type { ClickFeatures, ClickRecord, Decision, LogExport } from '../src/core/types';
import { DEFAULT_OPTIONS, generate } from '../synth/generate';
import { decideAll } from './decisions';
import { splitter, type Split } from './split';

export interface Tools {
  /** The repo root. */
  root: string;
  /** Bundles the worker with the decision in a folder and returns the bundle's path. */
  bundleWorker(decisionDir: string): Promise<string>;
}

const USAGE = `usage:
  score <log.json...> [--decision <dir>] [--split all|train|test] [--json]
      Score a decision on a log. The default split is all.
  gates <log.json...> [--decision <dir>] [--json]
      Judge the retargeting gates on the held-out split. Exits 0 only when both pass.
  split <log.json...> --train <out.json>
      Write the train split to a file. The test split is never written.
  synth --out <file> [--seed <n>] [--days <n>] [--sites <n>] [--clicks <n>]
      Write a synthetic log with ground-truth review marks.
The default decision is src/decision.`;

interface Args {
  files: string[];
  flags: Map<string, string>;
}

function parse(argv: string[]): Args {
  const files: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) files.push(arg);
    else if (arg === '--json') flags.set('json', 'true');
    else flags.set(arg.slice(2), argv[++i] ?? '');
  }
  return { files, flags };
}

/** Reads and merges exported logs. A record or review that appears twice is kept once. */
export async function loadLogs(files: string[]): Promise<LogExport> {
  if (files.length === 0) throw new Error('Give at least one exported log file.');
  const logs: LogExport[] = [];
  for (const file of files) {
    const log = JSON.parse(await readFile(file, 'utf8')) as Partial<LogExport>;
    if (log.format !== 'heyo-log' || log.v !== 1) {
      throw new Error(`${file} is not a heyo log export.`);
    }
    logs.push(log as LogExport);
  }
  const records = new Map(logs.flatMap((l) => l.records).map((r) => [r.id, r]));
  const reviews = new Map(
    logs
      .flatMap((l) => l.reviews)
      .sort((a, b) => a.t - b.t)
      .map((r) => [`${r.recordId}:${r.candidate}`, r]),
  );
  const counts = new Map(logs.flatMap((l) => l.counts).map((c) => [`${c.day}|${c.site}`, c]));
  return {
    ...logs.at(-1)!,
    exportedAt: Math.max(...logs.map((l) => l.exportedAt)),
    records: [...records.values()].sort((a, b) => a.t - b.t),
    reviews: [...reviews.values()],
    counts: [...counts.values()],
  };
}

function inSplit(log: LogExport, split: Split | 'all'): ClickRecord[] {
  if (split === 'all') return log.records;
  const parts = splitter(log.records);
  return log.records.filter((record) => parts.of(record) === split);
}

export interface Scored {
  split: Split | 'all';
  score: Score;
  /** How often the decision gave each answer. */
  answers: Record<string, number>;
}

/** Runs the decision in `decisionDir` over one split of a log. */
export async function scoreSplit(
  log: LogExport,
  split: Split | 'all',
  decisionDir: string,
  tools: Tools,
): Promise<Scored> {
  const records = inSplit(log, split);
  const worker = await tools.bundleWorker(decisionDir);
  const decisions = await decideAll(
    worker,
    records.map((r) => r.features),
  );
  const byFeatures = new Map<ClickFeatures, Decision>(
    records.map((r, i) => [r.features, decisions[i]!]),
  );
  const answers: Record<string, number> = {};
  for (const decision of decisions) {
    const key = decision.action === 'retarget' ? 'retarget' : `refuse: ${decision.reason}`;
    answers[key] = (answers[key] ?? 0) + 1;
  }
  return {
    split,
    score: score(records, log.reviews, (features) => byFeatures.get(features)!),
    answers,
  };
}

function percent(value: number | null, digits = 1): string {
  return value === null ? 'none' : `${(100 * value).toFixed(digits)}%`;
}

function table(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, value]) => `  ${name.padEnd(width)}  ${value}`).join('\n');
}

const STATUS: Record<GateStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  inconclusive: 'NOT ENOUGH DATA',
};

function describe(scored: Scored): string {
  const s = scored.score;
  const lines = [
    `Split: ${scored.split} (${s.records} empty-space clicks)`,
    table([
      ['labeled misses', String(s.misses)],
      ['recovered', `${s.recovered} (${percent(s.recovery)})`],
      ['would-be fires', String(s.fires)],
      ['fires on a miss that picked another control', String(s.proxyWrong)],
      ['fires reviewed', String(s.reviewed)],
      ['reviewed wrong', String(s.wrong)],
      ['reviewed not sure', String(s.unsure)],
      ['wrong-target rate, 95% upper bound', percent(s.wrongUpper, 2)],
      ['fires followed by a second press', String(s.doublePress)],
    ]),
    'Decisions:',
    table(
      Object.entries(scored.answers)
        .sort((a, b) => b[1] - a[1])
        .map(([answer, n]) => [answer, String(n)]),
    ),
  ];
  return lines.join('\n');
}

async function scoreCommand(args: Args, tools: Tools): Promise<number> {
  const log = await loadLogs(args.files);
  const split = (args.flags.get('split') ?? 'all') as Split | 'all';
  if (!['all', 'train', 'test'].includes(split)) throw new Error(`Unknown split "${split}".`);
  const decisionDir = resolve(args.flags.get('decision') ?? `${tools.root}/src/decision`);
  const scored = await scoreSplit(log, split, decisionDir, tools);
  console.log(args.flags.has('json') ? JSON.stringify(scored) : describe(scored));
  return 0;
}

async function gatesCommand(args: Args, tools: Tools): Promise<number> {
  const log = await loadLogs(args.files);
  const decisionDir = resolve(args.flags.get('decision') ?? `${tools.root}/src/decision`);
  const scored = await scoreSplit(log, 'test', decisionDir, tools);
  const gates = retargetGates(scored.score);
  const rate = missRate(log.records, log.counts, dayOf(log.exportedAt));
  const rateGate = missRateGate(rate);
  if (args.flags.has('json')) {
    console.log(JSON.stringify({ gates, missRate: rate, missRateGate: rateGate, scored }));
    return gates.pass ? 0 : 1;
  }
  const { recovery, wrongTarget } = gates;
  console.log(describe(scored));
  console.log('\nGates in front of retargeting, on the held-out split:');
  console.log(
    table([
      [
        'proxy recovery at least 50%',
        `${STATUS[recovery.status]}  ${percent(recovery.recovery)} of ${recovery.misses} labeled misses`,
      ],
      [
        'verified wrong-target rate under 1%',
        `${STATUS[wrongTarget.status]}  ${wrongTarget.wrong} wrong in ${wrongTarget.reviewed} reviewed fires, upper bound ${percent(wrongTarget.upper, 2)}, needs ${wrongTarget.needed} reviewed`,
      ],
    ]),
  );
  console.log('\nShadow-mode stop condition, on the whole log:');
  console.log(
    table([
      [
        'misses at least 0.5% of clicks and 3 a day',
        `${STATUS[rateGate.status]}  ${percent(rate.rate, 2)} of ${rate.clicks} clicks, ${rate.perDay?.toFixed(1) ?? 'none'} a day over ${rate.elapsedDays} days`,
      ],
    ]),
  );
  console.log(
    gates.pass ? '\nBoth retargeting gates pass.' : '\nRetargeting stays off. A gate did not pass.',
  );
  return gates.pass ? 0 : 1;
}

async function splitCommand(args: Args): Promise<number> {
  const out = args.flags.get('train');
  if (!out) throw new Error('Give --train <out.json>.');
  const log = await loadLogs(args.files);
  const records = inSplit(log, 'train');
  const ids = new Set(records.map((r) => r.id));
  const train: LogExport = {
    ...log,
    records,
    reviews: log.reviews.filter((r) => ids.has(r.recordId)),
  };
  await writeFile(out, `${JSON.stringify(train)}\n`);
  const { weeks, testWeeks } = splitter(log.records);
  console.log(
    `Wrote ${records.length} of ${log.records.length} records to ${out}. ` +
      `Held out: the last ${testWeeks} of ${weeks} weeks and a quarter of the sites.`,
  );
  return 0;
}

async function synthCommand(args: Args): Promise<number> {
  const out = args.flags.get('out');
  if (!out) throw new Error('Give --out <file>.');
  const number = (flag: string, fallback: number) => Number(args.flags.get(flag) ?? fallback);
  const log = generate({
    ...DEFAULT_OPTIONS,
    seed: number('seed', DEFAULT_OPTIONS.seed),
    days: number('days', DEFAULT_OPTIONS.days),
    sites: number('sites', DEFAULT_OPTIONS.sites),
    clicksPerDay: number('clicks', DEFAULT_OPTIONS.clicksPerDay),
  });
  await writeFile(out, `${JSON.stringify(log)}\n`);
  console.log(
    `Wrote ${log.records.length} records and ${log.reviews.length} review marks to ${out}.`,
  );
  return 0;
}

export async function main(argv: string[], tools: Tools): Promise<number> {
  const [command, ...rest] = argv;
  const args = parse(rest);
  try {
    if (command === 'score') return await scoreCommand(args, tools);
    if (command === 'gates') return await gatesCommand(args, tools);
    if (command === 'split') return await splitCommand(args);
    if (command === 'synth') return await synthCommand(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }
  console.log(USAGE);
  return 2;
}
