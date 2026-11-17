// Gets a decision module's answers for a list of clicks, from a locked-down child process.
import { spawn } from 'node:child_process';
import type { ClickFeatures, Decision } from '../src/core/types';

/** How long a decision module may take over a whole log. */
const TIMEOUT_MS = 120_000;

function isDecision(value: unknown, features: ClickFeatures): value is Decision {
  if (typeof value !== 'object' || value === null) return false;
  const decision = value as { action?: unknown; candidate?: unknown; reason?: unknown };
  if (decision.action === 'refuse') return typeof decision.reason === 'string';
  if (decision.action !== 'retarget') return false;
  const picked = features.candidates.find((c) => c.id === decision.candidate);
  // A decision may only pick a logged control. An opaque region is never a target.
  return picked?.kind === 'control';
}

/**
 * Runs the bundled worker over every click's features and returns one decision
 * per click, in order. The child process gets Node's permission system with
 * read access to its own bundle and nothing else.
 */
export function decideAll(workerBundle: string, all: ClickFeatures[]): Promise<Decision[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--permission', `--allow-fs-read=${workerBundle}`, workerBundle],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The decision took longer than ${TIMEOUT_MS / 1000} seconds.`));
    }, TIMEOUT_MS);

    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`The decision process exited with code ${code}.\n${err.trim()}`));
        return;
      }
      const lines = out.split('\n').filter((line) => line !== '');
      if (lines.length !== all.length) {
        reject(new Error(`Expected ${all.length} decisions and got ${lines.length}.`));
        return;
      }
      const decisions: Decision[] = [];
      for (const [i, line] of lines.entries()) {
        const answer: unknown = JSON.parse(line);
        if (!isDecision(answer, all[i]!)) {
          reject(new Error(`Click ${i} got an invalid decision: ${line}`));
          return;
        }
        decisions.push(answer);
      }
      resolve(decisions);
    });

    // If the child dies early its exit code and stderr say why. A broken pipe here adds nothing.
    child.stdin.on('error', () => undefined);
    for (const features of all) child.stdin.write(`${JSON.stringify(features)}\n`);
    child.stdin.end();
  });
}
