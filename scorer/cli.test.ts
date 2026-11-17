// Runs the real scorer command, with the decision in its locked-down child process.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LogExport } from '../src/core/types';
import { DEFAULT_OPTIONS, generate } from '../synth/generate';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));

let dir: string;
let logFile: string;

async function scorer(...args: string[]) {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

/** Writes a decision module into its own folder and returns the folder. */
async function decisionDir(name: string, source: string): Promise<string> {
  const folder = join(dir, name, 'decision');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'index.ts'), source);
  return folder;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'heyo-scorer-test-'));
  logFile = join(dir, 'log.json');
  await writeFile(logFile, JSON.stringify(generate({ ...DEFAULT_OPTIONS, days: 28 })));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the scorer command', () => {
  it('scores the shipped decision on a log', async () => {
    const { code, stdout } = await scorer('score', logFile, '--json');
    expect(code).toBe(0);
    const { score, answers } = JSON.parse(stdout) as {
      score: { misses: number; fires: number; reviewed: number };
      answers: Record<string, number>;
    };
    expect(score.misses).toBeGreaterThan(100);
    expect(score.fires).toBeGreaterThan(100);
    expect(score.reviewed).toBe(score.fires);
    expect(answers.retarget).toBe(score.fires);
  });

  it('judges the gates on the held-out split and exits 1 when one does not pass', async () => {
    const never = await decisionDir(
      'never',
      `export const decide = () => ({ action: 'refuse', reason: 'too-far' });`,
    );
    const { code, stdout } = await scorer('gates', logFile, '--decision', never);
    expect(code).toBe(1);
    expect(stdout).toContain('Split: test');
    expect(stdout).toContain('proxy recovery at least 50%          FAIL');
    expect(stdout).toContain('Retargeting stays off');
  });

  it('writes only the train split to a file', async () => {
    const out = join(dir, 'train.json');
    const { code } = await scorer('split', logFile, '--train', out);
    expect(code).toBe(0);
    const all = JSON.parse(await readFile(logFile, 'utf8')) as LogExport;
    const train = JSON.parse(await readFile(out, 'utf8')) as LogExport;
    expect(train.records.length).toBeGreaterThan(0);
    expect(train.records.length).toBeLessThan(all.records.length);
    const ids = new Set(train.records.map((r) => r.id));
    expect(train.reviews.every((r) => ids.has(r.recordId))).toBe(true);
    const lastTrain = Math.max(...train.records.map((r) => r.t));
    const lastAll = Math.max(...all.records.map((r) => r.t));
    expect(lastAll - lastTrain).toBeGreaterThan(6 * 86_400_000);
  });

  it('uses its own core even when the decision folder has an edited copy beside it', async () => {
    const folder = await decisionDir(
      'own-core',
      `import { distanceToRect } from '../core/geometry';
       export const decide = (f) =>
         distanceToRect({ x: 0, y: 0 }, { x: 3, y: 0, w: 1, h: 1 }) === 3
           ? { action: 'refuse', reason: 'too-far' }
           : { action: 'refuse', reason: 'drag' };`,
    );
    await mkdir(join(folder, '../core'), { recursive: true });
    await writeFile(
      join(folder, '../core/geometry.ts'),
      'export const distanceToRect = () => 999;',
    );
    const { code, stdout } = await scorer('score', logFile, '--decision', folder, '--json');
    expect(code).toBe(0);
    const { answers } = JSON.parse(stdout) as { answers: Record<string, number> };
    expect(Object.keys(answers)).toEqual(['refuse: too-far']);
  });
});

describe('a decision under the scorer', () => {
  it('cannot read files', async () => {
    const folder = await decisionDir(
      'reads',
      `import { readFileSync } from 'node:fs';
       export const decide = () => {
         readFileSync(${JSON.stringify(join(tmpdir(), 'anything'))});
         return { action: 'refuse', reason: 'too-far' };
       };`,
    );
    const { code, stderr } = await scorer('score', logFile, '--decision', folder);
    expect(code).toBe(2);
    expect(stderr).toMatch(/invalid decision|Access to this API has been restricted/);
  });

  it('cannot start processes or open network connections', async () => {
    // A real server to connect to, so a refused connection cannot be mistaken for a blocked one.
    const server = createServer((socket) => socket.end()).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const folder = await decisionDir(
      'spawns',
      `import { execSync } from 'node:child_process';
       import { connect } from 'node:net';
       let spawn = 'allowed';
       try { execSync('true'); } catch (error) { spawn = error.code; }
       const net = await new Promise((resolve) => {
         const socket = connect(${port}, '127.0.0.1');
         socket.on('connect', () => resolve('allowed'));
         socket.on('error', (error) => resolve(error.code));
       });
       export const decide = () => ({ action: 'refuse', reason: spawn + ' ' + net });`,
    );
    const { code, stdout } = await scorer('score', logFile, '--decision', folder, '--json');
    server.close();
    expect(code).toBe(0);
    const { answers } = JSON.parse(stdout) as { answers: Record<string, number> };
    expect(Object.keys(answers)).toEqual(['refuse: ERR_ACCESS_DENIED ERR_ACCESS_DENIED']);
  });

  it('sees only features, with no site, time, id, follow-up or review', async () => {
    const folder = await decisionDir(
      'peeks',
      `export const decide = (f) => {
         const keys = Object.keys(f).sort().join(',');
         const leaked = ['id', 'site', 't', 'followUp', 'decision', 'reviews'].some((k) => k in f);
         return { action: 'refuse', reason: leaked ? 'drag' : keys };
       };`,
    );
    const { stdout } = await scorer('score', logFile, '--decision', folder, '--json');
    const { answers } = JSON.parse(stdout) as { answers: Record<string, number> };
    expect(Object.keys(answers)).toEqual([
      'refuse: blurred,candidates,churn,focused,leftField,listenersOnPath,mutations,path,point,press,reacted,reaction,scale,topFrame,under,viewport',
    ]);
  });

  it('is rejected when it picks a control that was not logged', async () => {
    const folder = await decisionDir(
      'invents',
      `export const decide = () => ({ action: 'retarget', candidate: 99 });`,
    );
    const { code, stderr } = await scorer('score', logFile, '--decision', folder);
    expect(code).toBe(2);
    expect(stderr).toContain('invalid decision');
  });
});
