import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __HEYO_DECISION_VERSION__: JSON.stringify('test') },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
