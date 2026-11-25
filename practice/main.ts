// The practice run. A person clicks whichever control the practice page
// lights up, over and over, in a browser with the built extension loaded.
// The page knows which control each click was for, so every click heyo logs
// there is marked right or wrong without a hand review. The result is a log
// the scorer reads like any other.
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { LogExport } from '../src/core/types';
import { join, type PracticeLog, type Tally } from './join';

export interface Session {
  context: BrowserContext;
  worker: Worker;
}

export interface Tools {
  /** Starts Chromium with the built extension and a fresh profile in the given folder. */
  launch(profileDir: string): Promise<Session>;
  /** Serves the practice page. Resolves with the port and a way to stop. */
  serve(): Promise<{ port: number; close(): Promise<void> }>;
}

/** Clicks through the page in place of a person. Only tests pass one. */
export type Player = (page: Page) => Promise<void>;

export const DEFAULT_TRIALS = 240;

/** A name of its own for the page, so its records are easy to tell from any other site's. */
export const PRACTICE_HOST = 'practice.heyo.test';

/** The name of the function the page calls with its log. */
const SAVE = 'heyoPracticeSave';

/** heyo's log is copied this often, in hits, in case the browser goes away before the end. */
const COPY_EVERY = 10;

/** Time for the content script to hand its last record to the worker after the page goes. */
const HANDOVER_MS = 300;

const exportLog = (worker: Worker) => worker.evaluate(() => heyo.exportLog());

export interface Result {
  log: LogExport;
  tally: Tally;
  /** The page reached its end, or the person stopped it from the page. */
  finished: boolean;
}

/**
 * Opens the practice page and waits for the person to finish it or close the
 * window. Resolves with null when the window closed before heyo's log could
 * be copied even once.
 */
export async function run(trials: number, tools: Tools, player?: Player): Promise<Result | null> {
  const server = await tools.serve();
  const profile = await mkdtemp(joinPath(tmpdir(), 'heyo-practice-'));
  let session: Session | undefined;
  try {
    session = await tools.launch(profile);
    const { context, worker } = session;
    const page = context.pages()[0] ?? (await context.newPage());

    let practice: PracticeLog | null = null;
    let copy: LogExport | null = null;
    let copying = Promise.resolve();
    const keep = () => {
      copying = copying.then(() =>
        exportLog(worker).then(
          (log) => void (copy = log),
          // The browser closed under the copy. The last one stands.
          () => undefined,
        ),
      );
    };
    let end!: () => void;
    const ended = new Promise<void>((resolve) => (end = resolve));
    await page.exposeBinding(SAVE, (_source, snapshot: PracticeLog) => {
      practice = snapshot;
      if (snapshot.done) end();
      else if (snapshot.hits % COPY_EVERY === 0) keep();
    });
    page.once('close', () => end());
    context.once('close', () => end());

    await page.goto(`http://${PRACTICE_HOST}:${server.port}/index.html?trials=${trials}`);
    const playing = player?.(page);
    await ended;
    await playing;
    await copying;

    // Leaving the page makes its content script hand over what it still holds.
    if (!page.isClosed()) await page.goto('about:blank');
    await new Promise((resolve) => setTimeout(resolve, HANDOVER_MS));
    try {
      copy = await exportLog(worker);
    } catch {
      // The browser is gone. The last copy stands.
    }
    const last = practice as PracticeLog | null;
    if (!copy || !last) return null;
    return { ...join(copy, last), finished: last.done };
  } finally {
    await session?.context.close().catch(() => undefined);
    await server.close();
    await rm(profile, { recursive: true, force: true });
  }
}

const USAGE = `usage:
  practice --out <file> [--trials <n>]
      Open the practice page in a browser with the built extension, for a
      person to click through. Writes heyo's log of the run, with every
      candidate marked right or wrong from the control the page had lit.
      Run \`npm run build\` first. Score the result with \`npm run score -- <file>\`.`;

function describe(tally: Tally, finished: boolean): string {
  const share = (part: number, whole: number) =>
    whole === 0 ? 'none' : `${part} of ${whole} (${((100 * part) / whole).toFixed(1)}%)`;
  return [
    `Hits on the lit control: ${tally.hits} of ${tally.trials}${finished ? '' : ', stopped when the window closed'}`,
    `Presses: ${tally.presses}. On the lit control: ${tally.onTarget}. On another control: ${tally.onOther}. On neither: ${tally.onEmpty}.`,
    `Records heyo logged: ${tally.records}, of which matched a press on the page: ${tally.matched}`,
    `Records with the lit control among the candidates: ${tally.beside}`,
    `Fires by the decision in this build: ${tally.fires}. On the lit control: ${share(tally.right, tally.fires)}`,
    `Labeled misses: ${tally.labeled}. Retried on the lit control: ${share(tally.labeledRight, tally.labeled)}`,
  ].join('\n');
}

export async function main(argv: string[], tools: Tools): Promise<number> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2)
    flags.set(argv[i]!.replace(/^--/, ''), argv[i + 1] ?? '');
  const out = flags.get('out');
  const trials = Number(flags.get('trials') ?? DEFAULT_TRIALS);
  if (!out || !Number.isInteger(trials) || trials < 1) {
    console.log(USAGE);
    return 2;
  }
  console.log(
    `A browser window opens with the practice page. Click Start, then click each yellow control.\n` +
      `Finish now, at the top of the page, stops early and keeps what was done.`,
  );
  const result = await run(trials, tools);
  if (!result) {
    console.log('The window closed before anything was saved. Nothing was written.');
    return 1;
  }
  await writeFile(out, `${JSON.stringify(result.log)}\n`);
  console.log(describe(result.tally, result.finished));
  console.log(
    `Wrote ${result.log.records.length} records with ${result.log.reviews.length} marks to ${out}.\n` +
      `Score it with \`npm run score -- ${out}\`.`,
  );
  return 0;
}
