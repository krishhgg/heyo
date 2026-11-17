import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __HEYO_DECISION_VERSION__: JSON.stringify('test') },
  test: {
    include: [
      'src/**/*.test.ts',
      'scorer/**/*.test.ts',
      'synth/**/*.test.ts',
      'loop/**/*.test.ts',
      'scripted/**/*.test.ts',
    ],
  },
});
