// Runs the real loop command with scripted agents in place of a coding agent.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { splitter } from '../scorer/split';
import type { LogExport } from '../src/core/types';
import { DEFAULT_OPTIONS, generate } from '../synth/generate';
import {
  codePaths,
  copyInto,
  isBetter,
  isInside,
  runAgent,
  sandboxProfile,
  type LoopResult,
  type Standing,
} from './main';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'loop/cli.mjs');
const canSandbox = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');

let dir: string;
let logFile: string;
let log: LogExport;

/** Writes a scripted agent and returns the shell command that runs it. */
async function agent(name: string, source: string): Promise<string> {
  const file = join(dir, `${name}.mjs`);
  await writeFile(file, source);
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(file)}`;
}

async function loop(name: string, command: string, rounds = 1) {
  const workspace = join(dir, name);
  try {
    await run(process.execPath, [
      cli,
      'run',
      ...['--log', logFile, '--agent', command, '--rounds', String(rounds)],
      ...['--workspace', workspace, '--decision', join(root, 'loop/fixtures/decision')],
    ]);
  } catch {
    // The command exits 1 when a held-out gate does not pass, which these runs expect.
  }
  const result = JSON.parse(
    await readFile(`${await realpath(workspace)}.private/result.json`, 'utf8'),
  ) as LoopResult;
  return { workspace, result };
}

const edit = (from: string, to: string) => `
  import { readFileSync, writeFileSync } from 'node:fs';
  const source = readFileSync('decision/index.ts', 'utf8');
  writeFileSync('decision/index.ts', source.replace(${JSON.stringify(from)}, ${JSON.stringify(to)}));
`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'heyo-loop-test-'));
  logFile = join(dir, 'log.json');
  log = generate({ ...DEFAULT_OPTIONS, days: 42 });
  await writeFile(logFile, JSON.stringify(log));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('codePaths', () => {
  it('lists the repo, Node, and packages that sit outside the repo behind a link', async () => {
    const repo = await realpath(await mkdtemp(join(tmpdir(), 'heyo-paths-')));
    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'heyo-packages-')));
    await symlink(elsewhere, join(repo, 'node_modules'));
    const paths = await codePaths(repo);
    expect(paths).toContain(repo);
    expect(paths).toContain(elsewhere);
    expect(paths).toContain(dirname(await realpath(process.execPath)));
    await rm(repo, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });

  it('adds nothing for packages inside the repo, which the repo rule covers', async () => {
    const paths = await codePaths(await realpath(root));
    expect(paths.filter((path) => path.includes('node_modules'))).toEqual(
      existsSync(join(root, 'node_modules')) &&
        !(await realpath(join(root, 'node_modules'))).startsWith(await realpath(root))
        ? [await realpath(join(root, 'node_modules'))]
        : [],
    );
  });
});

describe('isInside', () => {
  it('tells a folder and what lies in it from a sibling with a longer name', () => {
    expect(isInside('/work/heyo', '/work/heyo')).toBe(true);
    expect(isInside('/work/heyo/loop', '/work/heyo')).toBe(true);
    expect(isInside('/work/heyo-work', '/work/heyo')).toBe(false);
  });
});

describe('copyInto', () => {
  it('makes an existing decision the same as the new one and leaves its tests alone', async () => {
    const from = await realpath(await mkdtemp(join(tmpdir(), 'heyo-best-')));
    const to = await realpath(await mkdtemp(join(tmpdir(), 'heyo-shipped-')));
    await mkdir(join(from, 'rules'));
    await writeFile(join(from, 'index.ts'), 'new index');
    await writeFile(join(from, 'rules/distance.ts'), 'new rule');
    await writeFile(join(to, 'index.ts'), 'old index');
    await writeFile(join(to, 'index.test.ts'), 'the tests');

    // A helper the new decision no longer has, and a note that is not a source file.
    await writeFile(join(to, 'helper.ts'), 'old helper');
    await writeFile(join(to, 'notes.md'), 'a note');

    await copyInto(from, to);
    expect(await readFile(join(to, 'index.ts'), 'utf8')).toBe('new index');
    expect(await readFile(join(to, 'rules/distance.ts'), 'utf8')).toBe('new rule');
    expect(await readFile(join(to, 'index.test.ts'), 'utf8')).toBe('the tests');
    expect(await readFile(join(to, 'notes.md'), 'utf8')).toBe('a note');
    expect(existsSync(join(to, 'helper.ts'))).toBe(false);
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  });
});

describe('running the agent', () => {
  it('stops everything the agent started when its time is up', async () => {
    const work = await realpath(await mkdtemp(join(tmpdir(), 'heyo-agent-')));
    // The shell starts a process of its own and waits, the way an agent command starts its tools.
    const late = `${JSON.stringify(process.execPath)} -e "setTimeout(() => require('fs').writeFileSync('late.txt', 'x'), 1500)" & wait`;
    const ran = await runAgent(late, work, null, 300);
    expect(ran.timedOut).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(existsSync(join(work, 'late.txt'))).toBe(false);
    await rm(work, { recursive: true, force: true });
  });

  it('stops what the agent left running when it returns', async () => {
    const work = await realpath(await mkdtemp(join(tmpdir(), 'heyo-agent-')));
    const left = `${JSON.stringify(process.execPath)} -e "setTimeout(() => require('fs').writeFileSync('late.txt', 'x'), 1000)" &`;
    const ran = await runAgent(left, work, null, 10_000);
    expect(ran).toEqual({ code: 0, timedOut: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(existsSync(join(work, 'late.txt'))).toBe(false);
    await rm(work, { recursive: true, force: true });
  });
});

describe('the sandbox profile', () => {
  it('closes private folders to reads and writes and code folders to writes', () => {
    const profile = sandboxProfile(['/logs/a.json'], ['/repo'], ['/run.private', '/tmp/cache']);
    expect(profile).toContain('(deny file-read* (literal "/logs/a.json"))');
    for (const path of ['/run.private', '/tmp/cache']) {
      expect(profile).toContain(`(deny file-read* (subpath "${path}"))`);
      expect(profile).toContain(`(deny file-write* (subpath "${path}"))`);
    }
    expect(profile).toContain('(deny file-write* (subpath "/repo"))');
    expect(profile).not.toContain('(deny file-read* (subpath "/repo"))');
  });
});

describe('isBetter', () => {
  const standing = (underCeiling: boolean, recovery: number, wrongUpper: number) =>
    ({ underCeiling, score: { recovery, wrongUpper } }) as Standing;

  it('puts getting under the ceiling first', () => {
    expect(isBetter(standing(true, 0.3, 0.008), standing(false, 0.9, 0.05))).toBe(true);
    expect(isBetter(standing(false, 0.9, 0.05), standing(true, 0.3, 0.008))).toBe(false);
  });

  it('above the ceiling, wants a lower wrong-target bound', () => {
    expect(isBetter(standing(false, 0.4, 0.03), standing(false, 0.6, 0.05))).toBe(true);
    expect(isBetter(standing(false, 0.7, 0.05), standing(false, 0.6, 0.05))).toBe(false);
  });

  it('under the ceiling, wants higher recovery', () => {
    expect(isBetter(standing(true, 0.55, 0.009), standing(true, 0.5, 0.004))).toBe(true);
    expect(isBetter(standing(true, 0.5, 0.004), standing(true, 0.5, 0.009))).toBe(false);
  });
});

describe('the loop', () => {
  it('gives the agent the train split and nothing from the held-out split', async () => {
    const { workspace } = await loop('peek', await agent('idle', ''));
    const train = JSON.parse(await readFile(join(workspace, 'train.json'), 'utf8')) as LogExport;
    const parts = splitter(log.records);
    const heldOut = new Set(log.records.filter((r) => parts.of(r) === 'test').map((r) => r.id));
    expect(heldOut.size).toBeGreaterThan(100);
    expect(train.records.length).toBeGreaterThan(100);
    expect(train.records.some((r) => heldOut.has(r.id))).toBe(false);
    expect(train.reviews.some((r) => heldOut.has(r.recordId))).toBe(false);
    for (const name of [
      'TASK.md',
      'score',
      'lint',
      'history.md',
      'decision/index.ts',
      'core/types.ts',
    ]) {
      expect(existsSync(join(workspace, name)), name).toBe(true);
    }
  });

  it('keeps a change that lowers the wrong-target bound', async () => {
    // Refuse whenever a second control is less than 8 px farther than the nearest.
    const before = `if (nearest.disabled) return refuse('disabled');`;
    const added = `if (runnerUp && runnerUp.dist < nearest.dist + 8) return refuse('ambiguous');`;
    const tighter = await agent('tighter', edit(before, `${added}\n  ${before}`));
    const { workspace, result } = await loop('tighter', tighter);
    expect(result.rounds[0]).toMatchObject({ round: 1, kept: true });
    expect(await readFile(join(result.best, 'index.ts'), 'utf8')).toContain('nearest.dist + 8');
    expect(await readFile(join(workspace, 'history.md'), 'utf8')).toMatch(/Round 1: kept/);
  });

  it('undoes a change that is not better', async () => {
    const looser = await agent('looser', edit('const MAX_DIST = 12;', 'const MAX_DIST = 30;'));
    const { workspace, result } = await loop('looser', looser);
    expect(result.rounds[0]).toMatchObject({ kept: false });
    expect(result.rounds[0]!.note).toMatch(/not better, undone/);
    expect(await readFile(join(workspace, 'decision/index.ts'), 'utf8')).toContain(
      'const MAX_DIST = 12;',
    );
  });

  it('undoes a change the lint rejects', async () => {
    const cheat = await agent(
      'cheat',
      edit('const MAX_DIST = 12;', `const MAX_DIST = 4;\nconst SITE = 'mail.example.com';`),
    );
    const { workspace, result } = await loop('cheat', cheat);
    expect(result.rounds[0]).toMatchObject({ kept: false });
    expect(result.rounds[0]!.note).toMatch(/rejected by the lint/);
    expect(await readFile(join(workspace, 'decision/index.ts'), 'utf8')).not.toContain('SITE');
  });

  it('goes on when the agent removes the decision folder', async () => {
    const gone = await agent(
      'gone',
      `import { rmSync } from 'node:fs';\nrmSync('decision', { recursive: true });`,
    );
    const { workspace, result } = await loop('gone', gone, 2);
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]).toMatchObject({ kept: false });
    expect(result.rounds[0]!.note).toMatch(/could not be read/);
    // The best decision is put back, and the held-out split is still judged.
    expect(await readFile(join(workspace, 'decision/index.ts'), 'utf8')).toContain('MAX_DIST');
    expect(result.heldOut).toBeDefined();
  });

  it.runIf(canSandbox)('stops the agent from reading the log or editing the scorer', async () => {
    const snoop = await agent(
      'snoop',
      `import { readFileSync, writeFileSync, appendFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
       import { tmpdir } from 'node:os';
       import { dirname, join } from 'node:path';
       const tried = {};
       try { readFileSync(${JSON.stringify(logFile)}); tried.log = 'read'; } catch (error) { tried.log = error.code; }
       try { appendFileSync(${JSON.stringify(join(root, 'scorer/main.ts'))}, ''); tried.scorer = 'wrote'; } catch (error) { tried.scorer = error.code; }
       try { readFileSync(process.cwd() + '.private/best/index.ts'); tried.private = 'read'; } catch (error) { tried.private = error.code; }
       // The packages the runner loads, which can sit outside the repo behind a link, and Node itself.
       try { appendFileSync(realpathSync(${JSON.stringify(join(root, 'node_modules/typescript/package.json'))}), ''); tried.packages = 'wrote'; } catch (error) { tried.packages = error.code; }
       try { appendFileSync(process.execPath, ''); tried.node = 'wrote'; } catch (error) { tried.node = error.code; }
       // The runner writes worker code into a folder in the temp directory and then runs it.
       // Other runs have such folders too, and only this run's is closed to the agent.
       tried.caches = readdirSync(tmpdir())
         .filter((name) => name.startsWith('heyo-scorer-'))
         .map((name) => {
           const probe = join(tmpdir(), name, 'probe-' + process.pid);
           try { writeFileSync(probe, ''); rmSync(probe); return 'wrote'; } catch (error) { return error.code; }
         })
         .filter((code) => code === 'EPERM').length;
       writeFileSync('tried.json', JSON.stringify(tried));`,
    );
    const { workspace } = await loop('snoop', snoop);
    const tried = JSON.parse(await readFile(join(workspace, 'tried.json'), 'utf8')) as object;
    expect(tried).toEqual({
      log: 'EPERM',
      scorer: 'EPERM',
      private: 'EPERM',
      packages: 'EPERM',
      node: 'EPERM',
      caches: 1,
    });
  });

  it.runIf(canSandbox)('lets the agent run the scorer and the lint on its own copy', async () => {
    const checks = await agent(
      'checks',
      `import { execFileSync } from 'node:child_process';
       import { writeFileSync } from 'node:fs';
       const score = execFileSync('./score', ['--json'], { encoding: 'utf8' });
       const lint = execFileSync('./lint', { encoding: 'utf8' });
       writeFileSync('checks.json', JSON.stringify({ misses: JSON.parse(score).score.misses, lint }));`,
    );
    const { workspace } = await loop('checks', checks);
    const seen = JSON.parse(await readFile(join(workspace, 'checks.json'), 'utf8')) as {
      misses: number;
      lint: string;
    };
    expect(seen.misses).toBeGreaterThan(50);
    expect(seen.lint).toContain('passes the lint');
  });
});
