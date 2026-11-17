import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      '.verify/',
      'mac/',
      // A decision fixture. Its "../core" import resolves only through the scorer and the lint.
      'loop/fixtures/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Drives pass functions to worker.evaluate and page.evaluate, which run in the browser.
    files: ['.claude/skills/verify-heyo/scripts/**/*.mjs', 'scripts/store-shots.mjs'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly', heyo: 'readonly' } },
  },
  prettier,
);
