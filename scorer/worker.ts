// Runs a decision module in its own process. The scorer starts this with
// Node's permission system on and no file, network or process access, and
// feeds it one click's features per line. It never sees a site, a time, a
// follow-up or a review mark.
import { createInterface } from 'node:readline';
// @ts-expect-error The bundler points this at the decision folder under test.
import { decide } from 'heyo-decision';
import type { ClickFeatures, Decide } from '../src/core/types';

const run = decide as Decide;

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  let answer: unknown;
  try {
    answer = run(JSON.parse(line) as ClickFeatures);
  } catch (error) {
    answer = { error: error instanceof Error ? error.message : String(error) };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
