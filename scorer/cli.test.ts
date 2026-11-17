// Runs the real scorer command, with the decision in its locked-down child process.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LogExport } from '../src/core/types';
import { DEFAULT_OPTIONS, generate } from '../synth/generate';
import { reachesNetwork } from './decisions';

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

describe('several exports scored together', () => {
  it('take the later export where two hold the same day, whatever order they are named in', async () => {
    const log = JSON.parse(await readFile(logFile, 'utf8')) as LogExport;
    const [first] = log.counts;
    const older: LogExport = { ...log, exportedAt: log.exportedAt - 86_400_000 };
    older.counts = [{ ...first!, clicks: 1, hits: 1, emptyReacted: 0, emptyIgnored: 0 }];
    older.records = [];
    older.reviews = [];
    const olderFile = join(dir, 'older.json');
    await writeFile(olderFile, JSON.stringify(older));

    const clicksOf = async (...files: string[]) => {
      const { stdout } = await scorer('gates', ...files, '--json');
      return (JSON.parse(stdout) as { missRate: { clicks: number } }).missRate.clicks;
    };
    const alone = await clicksOf(logFile);
    expect(await clicksOf(olderFile, logFile)).toBe(alone);
    expect(await clicksOf(logFile, olderFile)).toBe(alone);
  });

  it('add the clicks of logs that share no record, as two browsers on the same days do', async () => {
    const other = generate({ ...DEFAULT_OPTIONS, days: 28, seed: 2 });
    const otherFile = join(dir, 'other.json');
    await writeFile(otherFile, JSON.stringify(other));
    const rateOf = async (...files: string[]) => {
      const { stdout } = await scorer('gates', ...files, '--json');
      return (JSON.parse(stdout) as { missRate: { clicks: number; misses: number } }).missRate;
    };
    const [one, two, both] = [
      await rateOf(logFile),
      await rateOf(otherFile),
      await rateOf(logFile, otherFile),
    ];
    expect(both.clicks).toBe(one.clicks + two.clicks);
    expect(both.misses).toBe(one.misses + two.misses);
  });
});

describe('the check that a locked-down process is off the network', () => {
  it('sees a process with no lock reach a local server, and one with the lock fail to', async () => {
    expect(await reachesNetwork([])).toBe(true);
    expect(await reachesNetwork(['--permission'])).toBe(false);
  });
});

describe('a decision under the scorer', () => {
  it('cannot read files', async () => {
    const folder = await decisionDir(
      'reads',
      // No import: the bundler refuses those. Node hands out its modules without one.
      `const { readFileSync } = process.getBuiltinModule('node:fs');
       export const decide = () => {
         readFileSync(${JSON.stringify(logFile)});
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
      `const { execSync } = process.getBuiltinModule('node:child_process');
       const { connect } = process.getBuiltinModule('node:net');
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

  it("cannot read the caller's environment", async () => {
    const folder = await decisionDir(
      'env',
      `export const decide = () => ({ action: 'refuse', reason: process.env.HEYO_TEST_SECRET ?? 'unset' });`,
    );
    process.env.HEYO_TEST_SECRET = 'a-secret';
    const { code, stdout } = await scorer('score', logFile, '--decision', folder, '--json');
    delete process.env.HEYO_TEST_SECRET;
    expect(code).toBe(0);
    expect(stdout).not.toContain('a-secret');
    const { answers } = JSON.parse(stdout) as { answers: Record<string, number> };
    expect(Object.keys(answers)).toEqual(['refuse: unset']);
  });

  it('cannot import the log, a Node module or a file outside its folder', async () => {
    // The bundler runs outside the locked-down process, so an import would be read there.
    const imports = [
      `import used from ${JSON.stringify(logFile)};`,
      `import used from '../../log.json';`,
      `import { readFileSync as used } from 'node:fs';`,
      `import { score as used } from '../../../scorer/main';`,
      `const used = await import(${JSON.stringify(logFile)});`,
    ];
    for (const [i, line] of imports.entries()) {
      // The import is used, or TypeScript would drop it before the bundler looked.
      const folder = await decisionDir(
        `imports-${i}`,
        `${line}\nexport const decide = () => ({ action: 'refuse', reason: typeof used });`,
      );
      const { code, stderr } = await scorer('score', logFile, '--decision', folder);
      expect(code, line).toBe(2);
      expect(stderr, line).toContain('A decision may import only its own .ts files');
    }
  });

  it('cannot reach the log through a link inside its folder', async () => {
    const folder = await decisionDir(
      'links',
      `import log from './labels';
       export const decide = () => ({ action: 'refuse', reason: typeof log });`,
    );
    await symlink(logFile, join(folder, 'labels.ts'));
    const { code, stderr } = await scorer('score', logFile, '--decision', folder);
    expect(code).toBe(2);
    expect(stderr).toContain('A decision may import only its own .ts files');
  });

  it('cannot be a link to a file outside its folder', async () => {
    const folder = await decisionDir('linked', '');
    const outside = join(dirname(folder), 'outside.ts');
    await writeFile(
      outside,
      `export const decide = () => ({ action: 'refuse', reason: 'too-far' });`,
    );
    await rm(join(folder, 'index.ts'));
    await symlink(outside, join(folder, 'index.ts'));
    const { code, stderr } = await scorer('score', logFile, '--decision', folder);
    expect(code).toBe(2);
    expect(stderr).toContain('not a link out of it');
  });

  it('may import its own files, from a subfolder too', async () => {
    const folder = await decisionDir(
      'split',
      `import { reason } from './rules/far';
       export const decide = () => ({ action: 'refuse', reason });`,
    );
    await mkdir(join(folder, 'rules'));
    await writeFile(join(folder, 'rules/far.ts'), `export { reason } from '../words';`);
    await writeFile(join(folder, 'words.ts'), `export const reason = 'too-far';`);
    const { code, stdout } = await scorer('score', logFile, '--decision', folder, '--json');
    expect(code).toBe(0);
    const { answers } = JSON.parse(stdout) as { answers: Record<string, number> };
    expect(Object.keys(answers)).toEqual(['refuse: too-far']);
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
