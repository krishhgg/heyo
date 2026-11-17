# heyo

Forgiving clicks. When a mouse click lands on empty, non-interactive space and one nearby clickable element is clearly the one you aimed for, heyo sends the click to that element. Clicks that already hit something are never touched.

The approved plan is in [docs/plan.md](docs/plan.md). Defaults chosen during the build are in [docs/decisions.md](docs/decisions.md).

## Develop

```bash
npm ci
npx playwright install chromium
npm run build   # unpacked extension in dist/extension
npm run lint    # eslint, prettier, tsc
npm test        # unit tests
npm run e2e     # Playwright tests against the built extension
npm run verify -- doctor   # health check for the verification skill
```

`npm run e2e` and `npm run verify` need a fresh `npm run build`.

## Score a log

```bash
npm run synth -- --out synth.json   # or export a real log from the review page
npm run score -- synth.json
npm run gates -- synth.json
```

[docs/scoring.md](docs/scoring.md) explains the report, the held-out split and what a decision can see.

## Mac app

`mac/` holds the feasibility experiment for a macOS version. It has not been run yet, because it needs Accessibility permission. [docs/mac-feasibility.md](docs/mac-feasibility.md) says how to run it and how to read the result.

```bash
cd mac
swift test                                  # the parts that need no permission
swift run -c release heyo-feasibility check # says whether the permission is there
```
