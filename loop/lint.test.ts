import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error A build script in plain JavaScript, with no types of its own.
import { CORE_FILES } from '../scripts/decision-version.mjs';
import { ALLOWED_IMPORTS, lintDecision } from './lint';

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
  it('allows the same core files the decision version is made from', () => {
    // A core file the lint allowed and the version left out could change the
    // decision without changing its version, and pages would act under it unjudged.
    const hashed = (CORE_FILES as string[]).map((name) => `../core/${name.replace(/\.ts$/, '')}`);
    expect([...ALLOWED_IMPORTS].sort()).toEqual(hashed.sort());
  });

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

  it('rejects randomness reached without writing Math.random', () => {
    for (const hidden of [
      `Math['random']()`,
      `(() => { const m = Math; return m.random(); })()`,
      `(() => { const { random } = Math; return random(); })()`,
      `[Math][0].random()`,
      `(Math.valueOf() as { random(): number }).random()`,
      `Math.toString()`,
      `(() => 0).constructor('return Math.random()')()`,
      `(() => 0)['constructor']('return 1')()`,
    ]) {
      const messages = lint(body(`const x = ${hidden}; void x;`));
      expect(messages.join(' '), hidden).toMatch(/pure function|same answer/);
    }
    // Ordinary math stays allowed.
    expect(lint(body(`const x = Math.min(1, Math.hypot(3, 4)); void x;`))).toEqual([]);
  });

  it('rejects a key worked out at run time, which could spell anything', () => {
    for (const hidden of [
      `(() => { const k = 'constructor'; return (() => 0)[k]('return this')(); })()`,
      `(() => { const k: string = features.under.tag; return (features as never)[k]; })()`,
      `(() => { const { ['constr' + 'uctor']: c } = (() => 0) as never; return c; })()`,
      `(() => { const { constructor: c } = () => 0; return c; })()`,
      `Reflect.get(() => 0, 'constructor')`,
    ]) {
      const messages = lint(body(`const x = ${hidden}; void x;`));
      expect(messages.join(' '), hidden).toMatch(/pure function|computed key/);
    }
    // A number, or one of a few known words, stays allowed.
    const fine = body(
      `const first = features.candidates[0]; const axis: 'x' | 'y' = 'x'; void [first, features.point[axis]];`,
    );
    expect(lint(fine)).toEqual([]);
  });

  it('rejects a link, and an import that lands on one', () => {
    const source = `${HEAD}import { LUCK } from './helper';\nexport function decide(features: ClickFeatures): Decision {\n if (features.candidates.length > LUCK) ${refuse}\n ${refuse}\n}\n`;
    const dir = join(scratch, `case-${next++}`, 'decision');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.ts'), source);
    writeFileSync(join(dir, 'helper.test.ts'), 'export const LUCK = Math.random() * 137.25;\n');
    symlinkSync(join(dir, 'helper.test.ts'), join(dir, 'helper.ts'));
    const messages = lintDecision(dir, coreDir).map((p) => p.message);
    expect(messages.join(' ')).toMatch(/A link\./);
    expect(messages.join(' ')).toMatch(/Import of "\.\/helper"/);
  });

  it('rejects an import of a test file, which is neither linted nor kept', () => {
    const source = `${HEAD}import { LUCK } from './helper.test';\nexport function decide(features: ClickFeatures): Decision {\n if (features.candidates.length > LUCK) ${refuse}\n ${refuse}\n}\n`;
    const messages = lint(source, {
      'helper.test.ts': 'export const LUCK = Math.random() * 137.25;\n',
    });
    expect(messages[0]).toMatch(/Import of "\.\/helper\.test"/);
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

  it('reports an empty index.ts, or one with no import or export, and does not throw', () => {
    for (const source of ['', 'const pick = 1;\n']) {
      expect(lint(source).join(' ')).toMatch(/must export a function named decide/);
    }
  });

  it('rejects anything that could answer differently in the browser than in the scorer', () => {
    // The stack of an error names file:// under Node and another scheme in an extension.
    const stack = body(`if (new Error().stack?.includes('file')) ${refuse}`);
    expect(lint(stack).join(' ')).toMatch(/Use of the global "Error"/);
    for (const [line, message] of [
      [`if (typeof Symbol === 'function') ${refuse}`, /Use of the global "Symbol"/],
      [`if (JSON.stringify(features).length > 9) ${refuse}`, /Use of the global "JSON"/],
      [`try { features.candidates.at(0); } catch { ${refuse} }`, /try and catch/],
      [`if ((12).toLocaleString() === '12') ${refuse}`, /language settings/],
      [`if ('a'.localeCompare('b') < 0) ${refuse}`, /language settings/],
    ] as const) {
      expect(lint(body(line)).join(' '), line).toMatch(message);
    }
  });

  it('allows the few globals a rule needs', () => {
    const source = body(
      `const words = new Set(['delete']);
       const pattern = new RegExp('pay', 'i');
       const near = features.candidates.filter((c) => Number.isFinite(c.dist) && c.dist < Infinity);
       const label = String(near[0]?.label ?? '');
       if (Array.isArray(near) && (words.has(label) || pattern.test(label))) ${refuse}
       if (Object.keys(features.press).length > 9 || Math.max(1, near.length) > 9) ${refuse}`,
    );
    expect(lint(source)).toEqual([]);
  });

  it('rejects a decision folder that is a link', () => {
    const linked = join(scratch, `case-${next++}`);
    mkdirSync(linked, { recursive: true });
    symlinkSync(shipped, join(linked, 'decision'));
    expect(lintDecision(join(linked, 'decision'), coreDir).map((p) => p.message)).toEqual([
      'The decision folder is a link. It has to be a folder.',
    ]);
  });

  it('rejects a module-level variable that can be assigned again', () => {
    const counted = `${HEAD}let calls = 0;\nexport function decide(features: ClickFeatures): Decision {\n  calls += features.candidates.length;\n  ${refuse}\n}\n`;
    expect(lint(counted).join(' ')).toMatch(/module-level let or var/);
    expect(lint(counted.replace('let calls', 'var calls')).join(' ')).toMatch(
      /module-level let or var/,
    );
    // A let inside the function is the function's own business.
    expect(lint(body('let far = 0;\n far = Math.max(far, features.candidates.length);'))).toEqual(
      [],
    );
  });
});
