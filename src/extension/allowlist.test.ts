import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOWLIST } from './allowlist';

describe('the allowlist', () => {
  it('has a replay test for every site on it', () => {
    for (const { host } of ALLOWLIST) {
      const spec = fileURLToPath(new URL(`../../e2e/live/${host}.spec.ts`, import.meta.url));
      expect(existsSync(spec), `e2e/live/${host}.spec.ts`).toBe(true);
    }
  });

  it('records the day each site was last tested', () => {
    for (const { tested } of ALLOWLIST) expect(tested).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
