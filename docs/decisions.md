# Decisions

Defaults chosen while building heyo, each with the reason. The plan in [plan.md](plan.md) wins where the two disagree. A decision that corrects the plan also changes the plan in the same pull request.

## Repository and tooling

- MIT license. The repo is public and the code has no reason to restrict reuse.
- TypeScript 6.0, not 7. typescript-eslint 8 supports TypeScript below 6.1.
- esbuild bundles each extension script into one IIFE file with no minification. A reviewer can read the shipped code, and the Web Store review does not have to deal with obfuscated output.
- One npm package at the repo root, with no workspaces. The extension, the scorer and the tests share the pure modules in `src/core`.
- Squash merges only, and linear history on `main`. One pull request becomes one commit.
- Branch protection applies to admins too, so nobody can push to `main` directly.
- The verification skill lives in `.claude/skills/verify-heyo`, where Claude Code registers project skills. The pstack generator defaults to `.cursor/skills`.
- End-to-end tests run Playwright's bundled Chromium in the new headless mode. Branded Chrome no longer accepts `--load-extension`, and the new headless mode supports extensions.
- Test pages are served from `e2e/fixtures` over HTTP on port 41730. Content scripts do not run on file URLs unless the user allows it per extension. Set `HEYO_FIXTURE_PORT` to run a second instance side by side.
