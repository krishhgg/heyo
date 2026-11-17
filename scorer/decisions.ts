// Gets a decision module's answers for a list of clicks, from a locked-down child process.
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
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
 * Starts a Node process with the given flags and has it try to reach a local
 * server. Resolves true when it got through.
 */
export function reachesNetwork(flags: string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.end()).listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      // The probe exits with 7 only when it got through to the server.
      const probe = `const s = require('node:net').connect(${port}, '127.0.0.1');
        s.on('connect', () => process.exit(7));
        s.on('error', () => process.exit(0));`;
      // The same empty environment the decision gets, so the check sees what it will see.
      const child = spawn(process.execPath, [...flags, '-e', probe], { stdio: 'ignore', env: {} });
      child.on('error', reject);
      child.on('close', (code) => {
        server.close();
        resolve(code === 7);
      });
    });
    server.on('error', reject);
  });
}

let networkLocked: Promise<void> | null = null;

/**
 * Checks, once, that this Node keeps a locked-down process off the network.
 * Older versions of Node's permission system cover files and processes but not
 * sockets. A decision there could send click features out or ask a service
 * what to answer, so the scorer refuses to run on them.
 */
function assertNetworkLocked(): Promise<void> {
  networkLocked ??= reachesNetwork(['--permission']).then((reached) => {
    if (reached) {
      throw new Error(
        `Node ${process.version} does not keep a decision off the network. Use Node 26 or later.`,
      );
    }
  });
  return networkLocked;
}

/**
 * Runs the bundled worker over every click's features and returns one decision
 * per click, in order. The clicks are run twice, each time in a new process,
 * the second time in reverse order. A decision that answers the same click
 * differently is keeping something from one click to the next, and is refused.
 */
export async function decideAll(workerBundle: string, all: ClickFeatures[]): Promise<Decision[]> {
  await assertNetworkLocked();
  const [forward, backward] = await Promise.all([
    runWorker(workerBundle, all),
    runWorker(workerBundle, [...all].reverse()),
  ]);
  backward.reverse();
  const moved = forward.findIndex((d, i) => JSON.stringify(d) !== JSON.stringify(backward[i]));
  if (moved >= 0) {
    throw new Error(
      `Click ${moved} got an invalid decision: it changed when the clicks came in another order. A decision must depend on one click alone.`,
    );
  }
  return forward;
}

/**
 * One run of the bundled worker over every click's features, with one decision
 * per click, in order. The child process gets Node's permission system with
 * read access to its own bundle and nothing else, and an empty environment.
 */
function runWorker(workerBundle: string, all: ClickFeatures[]): Promise<Decision[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${workerBundle}`,
        // No eval and no new Function, so a decision cannot build code the lint never saw.
        '--disallow-code-generation-from-strings',
        workerBundle,
      ],
      // An empty environment. The permission system does not hide the caller's
      // variables, and a decision could hand one back as its reason.
      { stdio: ['pipe', 'pipe', 'pipe'], env: {} },
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
