# heyo verification map

This directory is the maintained source for verifying heyo's user-facing behavior. Read this index before driving the extension, then use the matching feature file as the recipe.

## Baseline preconditions

- `npm run build` has run since the last change under `src/`.
- `npm run verify -- doctor` prints `doctor: healthy`.
- Each drive starts its own browser and fixture server. Never drive a browser that this run did not start.

## Driving conventions

- Run every drive through `npm run verify -- run <feature>`.
- Use real pointer input on fixture pages in `e2e/fixtures/`.
- Read results from the extension, not from page state the drive set up itself.
- Treat every command as literal.

## Proof and skip reporting

- A proof has the transcript, the state read back from the extension in `result.json`, and a screenshot.
- Report an unreachable path with the command tried and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph on the user-visible behavior. It then has four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.mjs`, and `Gotchas`.

## Features

- [Extension loads](./extension-loads.md) covers loading the unpacked build and the content script running on a page.
- [Shadow capture](./shadow-capture.md) covers logging near misses, follow-ups, page reactions, hits, click counts and the privacy rules.
- [Mac feasibility experiment](./mac-experiment.md) covers the Swift package's tests, its permission check and how to run the experiment.
