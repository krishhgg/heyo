// Proves the agent loop end to end with a scripted agent in place of a coding
// agent: the workspace holds only the train split, a better change is kept, a
// worse one is undone, and on macOS the agent cannot read the log or touch the scorer.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../../../../', import.meta.url));

export async function drive({ evidence, log }) {
  const dir = await mkdtemp(join(tmpdir(), 'heyo-loop-drive-'));
  try {
    const logFile = join(dir, 'synth.json');
    await run(process.execPath, [
      join(root, 'scorer/cli.mjs'),
      'synth',
      '--out',
      logFile,
      '--days',
      '42',
    ]);
    log('wrote a 42-day synthetic log');

    // Round 1 adds a rule that refuses when a second control is nearly as close.
    // Round 2 loosens the distance cap, which is worse. Each round also tries to cheat.
    const agent = join(dir, 'agent.mjs');
    await writeFile(
      agent,
      `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
       const round = existsSync('round-1') ? 2 : 1;
       writeFileSync('round-' + round, '');
       const tried = {};
       try { readFileSync(${JSON.stringify(logFile)}); tried.log = 'read'; } catch (error) { tried.log = error.code; }
       try { appendFileSync(${JSON.stringify(join(root, 'scorer/main.ts'))}, ''); tried.scorer = 'wrote'; } catch (error) { tried.scorer = error.code; }
       writeFileSync('tried-' + round + '.json', JSON.stringify(tried));
       const file = 'decision/index.ts';
       const source = readFileSync(file, 'utf8');
       const anchor = "if (nearest.disabled) return refuse('disabled');";
       writeFileSync(file, round === 1
         ? source.replace(anchor, "if (runnerUp && runnerUp.dist < nearest.dist + 8) return refuse('ambiguous');\\n  " + anchor)
         : source.replace('const MAX_DIST = 12;', 'const MAX_DIST = 30;'));`,
    );

    const workspace = join(dir, 'workspace');
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(agent)}`;
    const args = [
      'run',
      '--log',
      logFile,
      '--agent',
      command,
      '--rounds',
      '2',
      '--workspace',
      workspace,
    ];
    const output = await run(process.execPath, [join(root, 'loop/cli.mjs'), ...args]).catch(
      (e) => e,
    );
    await writeFile(join(evidence, 'loop-output.txt'), `${output.stdout}${output.stderr}`);
    for (const line of output.stdout.trim().split('\n')) log(`loop: ${line}`);

    const history = await readFile(join(workspace, 'history.md'), 'utf8');
    await writeFile(join(evidence, 'history.md'), history);
    assert.match(history, /Round 1: kept/);
    assert.match(history, /Round 2: not better, undone/);

    const kept = await readFile(join(workspace, 'decision/index.ts'), 'utf8');
    assert.ok(kept.includes('nearest.dist + 8'), 'the better change is still in the workspace');
    assert.ok(kept.includes('const MAX_DIST = 12;'), 'the worse change was undone');

    const train = JSON.parse(await readFile(join(workspace, 'train.json'), 'utf8'));
    const all = JSON.parse(await readFile(logFile, 'utf8'));
    log(`the workspace got ${train.records.length} of ${all.records.length} records`);
    assert.ok(train.records.length < all.records.length);

    const result = JSON.parse(
      await readFile(`${await realpath(workspace)}.private/result.json`, 'utf8'),
    );
    await writeFile(join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

    if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
      const tried = JSON.parse(await readFile(join(workspace, 'tried-1.json'), 'utf8'));
      log(`the agent's attempts to read the log and edit the scorer: ${JSON.stringify(tried)}`);
      assert.deepEqual(tried, { log: 'EPERM', scorer: 'EPERM' });
    } else {
      log('no sandbox-exec on this machine, so the sandbox was not exercised');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
