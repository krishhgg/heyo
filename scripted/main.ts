// The scripted run. It takes the clicks the synthetic generator plans and plays
// them with a real mouse through the built extension, so the log holds what the
// real capture code measured. The result is scored like any other log.
import type { BrowserContext, Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, dayOf } from '../src/core/days';
import { distanceToRect } from '../src/core/geometry';
import type { ClickRecord, DayCount, LogExport, Review } from '../src/core/types';
import { CANDIDATE_RADIUS, clicks, DEFAULT_OPTIONS, type Click } from '../synth/generate';
import { Random } from '../synth/random';
import { play, type Played } from './play';
import { marksFor, placeOn } from './truth';

export interface Session {
  context: BrowserContext;
  worker: Worker;
}

export interface Tools {
  /** Starts Chromium with the built extension and a fresh profile in the given folder. */
  launch(profileDir: string): Promise<Session>;
  /** Serves the fixture pages. Resolves with the port and a way to stop. */
  serve(): Promise<{ port: number; close(): Promise<void> }>;
}

export interface ScriptedOptions {
  seed: number;
  days: number;
  sites: number;
  clicksPerDay: number;
  /** Browsers that play at once. */
  workers: number;
  /**
   * Share of clicks that cannot leave a record that is played anyway: plain
   * hits, and empty-space clicks with no control within 30 px. Playing all of
   * them would take a day and add nothing to the gates. The rest are added to
   * the day's click counts as the generator counted them.
   */
  plainShare: number;
}

export const DEFAULT_SCRIPTED: ScriptedOptions = {
  seed: DEFAULT_OPTIONS.seed,
  days: DEFAULT_OPTIONS.days,
  sites: DEFAULT_OPTIONS.sites,
  clicksPerDay: DEFAULT_OPTIONS.clicksPerDay,
  workers: 8,
  plainShare: 0.02,
};

type Kind = 'near' | 'plain';

/** The search samples points 6 px apart on its outer ring, so it can miss a corner this close to 30 px. */
const RING_SLACK_PX = 3;

interface Episode {
  click: Click;
  kind: Kind;
}

/** One simulated day: the clicks to play, and the counts of the ones left out. */
interface Day {
  episodes: Episode[];
  /** Clicks that are not played, counted as the generator counted them, by site. */
  leftOut: Map<string, Omit<DayCount, 'day'>>;
}

export interface Tally {
  planned: number;
  /** Clicks made into a window without focus. The run cannot take focus away from a page. */
  skippedUnfocused: number;
  skippedPlain: number;
  played: number;
  records: number;
  /** Records from a click planned to land on a control or far from every control. */
  unplanned: number;
  /**
   * Clicks planned on empty space beside a control that left no record, for a
   * reason the extension is right about. Near the 30 px end of the search, the
   * rings of sample points can miss a corner. A drag let go inside an iframe
   * gives the page no click at all.
   */
  silentFar: number;
  silentDrag: number;
  /** Any other such click. The extension should have logged it. */
  silent: string[];
  /** Aimed misses that were retried on the target, and how many logs say so. */
  retries: number;
  retriesLogged: number;
  /** Clicks where the generator's simulated record and the real one name the same nearest control. */
  compared: number;
  sameNearest: number;
}

/** Picks the clicks to play and groups them by simulated day. */
export function schedule(options: ScriptedOptions): { days: Day[]; tally: Tally } {
  const sample = new Random(options.seed + 0x5c81);
  const days: Day[] = Array.from({ length: options.days }, () => ({
    episodes: [],
    leftOut: new Map(),
  }));
  const tally: Tally = {
    planned: 0,
    skippedUnfocused: 0,
    skippedPlain: 0,
    played: 0,
    records: 0,
    unplanned: 0,
    silentFar: 0,
    silentDrag: 0,
    silent: [],
    retries: 0,
    retriesLogged: 0,
    compared: 0,
    sameNearest: 0,
  };
  const start = DEFAULT_OPTIONS.start;
  for (const click of clicks({ ...options, start })) {
    tally.planned++;
    const { plan } = click;
    const day = days[click.day]!;
    const nearest = Math.min(...plan.scene.map((c) => distanceToRect(plan.p, c.rect)));
    const kind: Kind = !plan.hit && nearest <= CANDIDATE_RADIUS ? 'near' : 'plain';
    const skipped = !plan.focused || (kind === 'plain' && !sample.chance(options.plainShare));
    if (!skipped) {
      day.episodes.push({ click, kind });
      continue;
    }
    if (plan.focused) tally.skippedPlain++;
    else tally.skippedUnfocused++;
    // A click that is not played still happened, so it stays in the day's counts.
    const site = hostOf(click);
    const count = day.leftOut.get(site) ?? {
      site,
      clicks: 0,
      hits: 0,
      emptyReacted: 0,
      emptyIgnored: 0,
    };
    count.clicks++;
    count[click.count]++;
    day.leftOut.set(site, count);
  }
  return { days, tally };
}

function hostOf(click: Click): string {
  return click.site.name.replace(/\.example$/, '.heyo.test');
}

interface DayResult {
  records: ClickRecord[];
  reviews: Review[];
  counts: DayCount[];
  versions: Pick<LogExport, 'extensionVersion' | 'decisionVersion'>;
}

/** Plays one simulated day in one browser and returns what the extension logged, with its marks. */
async function playDay(
  session: Session,
  port: number,
  { episodes, leftOut }: Day,
  tally: Tally,
): Promise<DayResult> {
  const page = session.context.pages()[0] ?? (await session.context.newPage());
  const played: (Played & Episode)[] = [];
  for (const [i, episode] of episodes.entries()) {
    const url = `http://${hostOf(episode.click)}:${port}/scripted.html?${i}`;
    played.push({ ...episode, ...(await play(page, url, episode.click)) });
    tally.played++;
  }
  // Leave the last page, so its content script hands over anything it still holds.
  await page.goto('about:blank');
  const log = await session.worker.evaluate(() => heyo.exportLog());
  await session.worker.evaluate(() => heyo.clearLog());

  const reviews: Review[] = [];
  for (const record of log.records) {
    const episode = played.find((e) => record.t >= e.from && record.t <= e.to);
    if (!episode) throw new Error(`A record at ${record.t} belongs to no played click.`);
    const { click, kind, origin } = episode;
    const marks = marksFor(record, click.plan, origin);
    reviews.push(...marks);
    tally.records++;
    if (kind === 'plain') tally.unplanned++;

    const target = marks.find((mark) => mark.verdict === 'right')?.candidate;
    const first = log.records.find((r) => r.t >= episode.from && r.t <= episode.to) === record;
    // The simulated record says whether the retry landed on the control the user aimed at.
    const retried = click.target != null && click.record?.followUp?.candidate === click.target;
    if (first && target !== undefined && retried) {
      tally.retries++;
      if (record.followUp?.candidate === target) tally.retriesLogged++;
    }
    const [simulated] = click.record?.features.candidates ?? [];
    const [real] = record.features.candidates;
    if (first && simulated && real) {
      tally.compared++;
      if (simulated.label === real.label && Math.abs(simulated.dist - real.dist) <= 1) {
        tally.sameNearest++;
      }
    }
  }
  for (const episode of played) {
    if (episode.kind !== 'near') continue;
    if (log.records.some((r) => r.t >= episode.from && r.t <= episode.to)) continue;
    const { plan } = episode.click;
    const nearest = Math.min(...plan.scene.map((c) => distanceToRect(plan.p, c.rect)));
    // The player drags to the right, by the planned distance.
    const end = { x: plan.p.x + plan.press.move, y: plan.p.y };
    const intoFrame =
      plan.intent === 'drag' &&
      plan.scene.some((c) => c.tag === 'iframe' && distanceToRect(end, c.rect) === 0);
    if (intoFrame) tally.silentDrag++;
    else if (nearest > CANDIDATE_RADIUS - RING_SLACK_PX) tally.silentFar++;
    else {
      tally.silent.push(
        `${plan.intent} click ${nearest.toFixed(1)} px from ${plan.scene.map((c) => c.tag).join(' ')}`,
      );
    }
  }
  // The clicks left out are added to the counts of the day this was played on.
  const today = dayOf(Date.now());
  const counts = new Map(log.counts.map((count) => [`${count.day}|${count.site}`, { ...count }]));
  for (const [site, extra] of leftOut) {
    const count = counts.get(`${today}|${site}`) ?? {
      day: today,
      site,
      clicks: 0,
      hits: 0,
      emptyReacted: 0,
      emptyIgnored: 0,
    };
    count.clicks += extra.clicks;
    count.hits += extra.hits;
    count.emptyReacted += extra.emptyReacted;
    count.emptyIgnored += extra.emptyIgnored;
    counts.set(`${today}|${site}`, count);
  }
  return {
    records: log.records,
    reviews,
    counts: [...counts.values()],
    versions: { extensionVersion: log.extensionVersion, decisionVersion: log.decisionVersion },
  };
}

/** Plays the whole schedule and returns one log, with each day moved back to its place. */
export async function run(
  options: ScriptedOptions,
  tools: Tools,
  report: (line: string) => void = () => undefined,
): Promise<{ log: LogExport; tally: Tally }> {
  const { days, tally } = schedule(options);
  const total = days.reduce((sum, day) => sum + day.episodes.length, 0);
  report(`Playing ${total} of ${tally.planned} planned clicks in ${options.workers} browsers.`);

  const server = await tools.serve();
  const work = await mkdtemp(join(tmpdir(), 'heyo-scripted-'));
  const queue = days.map((plan, day) => ({ day, plan }));
  // Fixed before the first click, so a run that goes past midnight keeps its dates.
  const lastDay = dayOf(Date.now());
  const results: (DayResult | undefined)[] = [];
  let done = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(options.workers, queue.length) }, async (_, n) => {
        const session = await tools.launch(join(work, `profile-${n}`));
        try {
          for (let next = queue.shift(); next; next = queue.shift()) {
            const result = await playDay(session, server.port, next.plan, tally);
            // The last simulated day is the day the run started, and each earlier one a day further back.
            results[next.day] = placeOn(result, addDays(lastDay, next.day - (options.days - 1)));
            done++;
            if (done % 7 === 0 || done === options.days) {
              report(`  ${done} of ${options.days} days, ${tally.records} records`);
            }
          }
        } finally {
          await session.context.close();
        }
      }),
    );
  } finally {
    await server.close();
    await rm(work, { recursive: true, force: true });
  }

  const all = results.filter((result) => result !== undefined);
  const log: LogExport = {
    format: 'heyo-log',
    v: 1,
    exportedAt: Date.now(),
    extensionVersion: all[0]?.versions.extensionVersion ?? '',
    decisionVersion: all[0]?.versions.decisionVersion ?? '',
    records: all.flatMap((result) => result.records).sort((a, b) => a.t - b.t),
    reviews: all.flatMap((result) => result.reviews),
    counts: all.flatMap((result) => result.counts),
  };
  return { log, tally };
}

const USAGE = `usage:
  scripted --out <file> [--seed <n>] [--days <n>] [--sites <n>] [--clicks <n>] [--workers <n>]
      Play the synthetic generator's clicks through the built extension and
      write the log it kept, with ground-truth review marks.
      Run \`npm run build\` first. Score the result with \`npm run gates -- <file>\`.`;

function describe(tally: Tally): string {
  const share = (part: number, whole: number) =>
    whole === 0 ? 'none' : `${part} of ${whole} (${((100 * part) / whole).toFixed(1)}%)`;
  return [
    `Planned clicks: ${tally.planned}`,
    `  played: ${tally.played}`,
    `  counted but not played, plain hits and far clicks that leave no record: ${tally.skippedPlain}`,
    `  counted but not played, made into a window without focus: ${tally.skippedUnfocused}`,
    `Records the extension logged: ${tally.records}`,
    `  from clicks planned as plain: ${tally.unplanned}`,
    `Clicks beside a control that left no record: ${tally.silentFar} at the far end of the search, ${tally.silentDrag} drags let go inside an iframe, ${tally.silent.length} unexplained`,
    ...tally.silent.map((line) => `  ${line}`),
    `Retries on the target that the log attached to the miss: ${share(tally.retriesLogged, tally.retries)}`,
    `Nearest control the same as the generator simulated: ${share(tally.sameNearest, tally.compared)}`,
  ].join('\n');
}

export async function main(argv: string[], tools: Tools): Promise<number> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2)
    flags.set(argv[i]!.replace(/^--/, ''), argv[i + 1] ?? '');
  const out = flags.get('out');
  if (!out) {
    console.log(USAGE);
    return 2;
  }
  const number = (flag: string, fallback: number) => Number(flags.get(flag) ?? fallback);
  const options: ScriptedOptions = {
    ...DEFAULT_SCRIPTED,
    seed: number('seed', DEFAULT_SCRIPTED.seed),
    days: number('days', DEFAULT_SCRIPTED.days),
    sites: number('sites', DEFAULT_SCRIPTED.sites),
    clicksPerDay: number('clicks', DEFAULT_SCRIPTED.clicksPerDay),
    workers: number('workers', DEFAULT_SCRIPTED.workers),
  };
  const started = Date.now();
  const { log, tally } = await run(options, tools, (line) => console.log(line));
  await writeFile(out, `${JSON.stringify(log)}\n`);
  console.log(describe(tally));
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(`Wrote ${log.records.length} records to ${out} in ${minutes} minutes.`);
  return 0;
}
