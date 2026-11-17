import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { lintDecision } from './lint';

const coreDir = fileURLToPath(new URL('../src/core', import.meta.url));
const shipped = fileURLToPath(new URL('../src/decision', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'heyo-lint-'));
let next = 0;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const HEAD = `import type { ClickFeatures, Decision } from '../core/types';\n`;
const refuse = `return { action: 'refuse', reason: 'too-far' };`;

/** Lints a decision whose index.ts is the given source, and returns the messages. */
function lint(source: string, extra: Record<string, string> = {}): string[] {
  const dir = join(scratch, `case-${next++}`, 'decision');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), source);
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(dir, name), text);
  return lintDecision(dir, coreDir).map((p) => p.message);
}

function body(lines: string): string {
  return `${HEAD}export function decide(features: ClickFeatures): Decision {\n${lines}\n${refuse}\n}\n`;
}

describe('the decision lint', () => {
  it('passes the shipped decision', () => {
    expect(lintDecision(shipped, coreDir)).toEqual([]);
  });

  it('passes the simple decision the loop tests start from', () => {
    const fixture = fileURLToPath(new URL('./fixtures/decision', import.meta.url));
    expect(lintDecision(fixture, coreDir)).toEqual([]);
  });

  it('passes a small rule with keywords and round numbers', () => {
    const source = body(
      `const words = ['delete', 'sign out'];
       const near = features.candidates.find((c) => c.dist <= 7.5);
       if (near && !words.some((w) => near.label.toLowerCase().includes(w))) {
         return { action: 'retarget', candidate: near.id };
       }`,
    );
    expect(lint(source)).toEqual([]);
  });

  it('rejects a hostname', () => {
    expect(lint(body(`if (features.under.label === 'mail.example.com') ${refuse}`))[0]).toMatch(
      /hostname/,
    );
  });

  it('rejects a selector', () => {
    for (const selector of ['#compose', '.btn-primary', 'div > a', '[data-id=x]', 'a:not(x)']) {
      const messages = lint(body(`if (features.under.label === '${selector}') ${refuse}`));
      expect(messages.join(' '), selector).toMatch(/selector|capitals|hostname/);
    }
  });

  it('rejects a label copied from one example', () => {
    expect(
      lint(body(`if (features.candidates[0]?.label === 'Reply to Jake') ${refuse}`))[0],
    ).toMatch(/capitals or digits/);
    const long = 'a very long sentence copied from a page';
    expect(lint(body(`if (features.under.label === '${long}') ${refuse}`))[0]).toMatch(
      /string of \d+ characters/,
    );
  });

  it('rejects a number fitted to one example and a table of numbers', () => {
    expect(lint(body(`if (features.candidates[0]?.rect.w === 137.25) ${refuse}`))[0]).toMatch(
      /significant digits/,
    );
    expect(lint(body(`const table = [1, 2, 3, 4, 5, 6, 7, 8, 9]; void table;`))[0]).toMatch(
      /lookup table/,
    );
  });

  it('rejects words hidden in a pattern or a template', () => {
    expect(lint(body(`if (/compose|inbox/.test(features.under.label)) ${refuse}`))[0]).toMatch(
      /pattern with words/,
    );
    expect(lint(body('const t = `compose ${features.under.tag}`; void t;'))[0]).toMatch(
      /template with words/,
    );
  });

  it('rejects anything that is not a pure function of the features', () => {
    for (const impure of [
      'Date.now()',
      'Math.random()',
      'process.env',
      'globalThis',
      'fetch',
      'eval',
      'new Function()',
      'console.log(1)',
    ]) {
      const messages = lint(body(`const x = ${impure}; void x;`));
      expect(messages.join(' '), impure).toMatch(/pure function|same answer/);
    }
  });

  it('rejects imports from outside the decision and the core', () => {
    const fs = `import { readFileSync } from 'node:fs';\n${body('void readFileSync;')}`;
    expect(lint(fs)[0]).toMatch(/Import of "node:fs"/);
    const up = `import { score } from '../core/metrics';\n${body('void score;')}`;
    expect(lint(up)[0]).toMatch(/Import of "\.\.\/core\/metrics"/);
    const dynamic = body(`void import('node:fs');`);
    expect(lint(dynamic).join(' ')).toMatch(/Dynamic import/);
  });

  it('allows a decision split across its own files', () => {
    const source = `${HEAD}import { CAP } from './limits';\nexport function decide(features: ClickFeatures): Decision {\n if (features.candidates.length > CAP) ${refuse}\n ${refuse}\n}\n`;
    expect(lint(source, { 'limits.ts': 'export const CAP = 3;\n' })).toEqual([]);
  });

  it('rejects a decision that reads something the features do not hold', () => {
    const source = body(
      `if ((features as { site?: string }).site) ${refuse}\n if (features.site) ${refuse}`,
    );
    expect(lint(source).join(' ')).toMatch(/Type error: Property 'site' does not exist/);
  });

  it('rejects a module with no decide export or far too many lines', () => {
    expect(lint(`${HEAD}export const pick = 1;\n`).join(' ')).toMatch(
      /must export a function named decide/,
    );
    expect(lint(`${body('')}${'// filler\n'.repeat(450)}`).join(' ')).toMatch(/at most 400/);
  });
});
