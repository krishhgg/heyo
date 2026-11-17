# Status

Last updated 17 November 2026.

## What works

- **Shadow mode.** The Chrome extension logs every empty-space click that has a control nearby: what was near, what the decision would have picked, whether the page reacted, and where the next press went. It changes nothing on any page. Installing it is one command and three clicks in Chrome, as the [README](../README.md) says.
- **Hand review and export.** The toolbar button opens the review page. The Review tab shows each would-be fire as a drawing and takes a mark from one key. The Numbers tab shows the miss rate, recovery and the wrong-target bound against the plan's limits, exports the log to a file and deletes it.
- **Scoring.** `npm run score` and `npm run gates` judge a decision on an exported log, with the decision kept away from the labels. `npm run synth` writes a synthetic log. `npm run scripted` plays the same clicks through the real extension with a real mouse. [scoring.md](scoring.md) explains the numbers.
- **The agent loop.** `npm run loop` lets a coding agent tune the decision on the train split of a log. On macOS the agent cannot read the held-out split or change the scorer. [agent-loop.md](agent-loop.md) has the command.
- **The decision.** It passes both of the plan's gates on the held-out split of six 24-week logs, three synthetic and three scripted: recovery from 52.9% to 58.9%, and a wrong-target upper bound from 0.39% to 0.72%. The table is in [decisions.md](decisions.md) under "Decision".
- **Retargeting.** With the gates passing on the local log, the Retargeting tab unlocks. heyo then sends a missed click on to its target on three sites: en.wikipedia.org, news.ycombinator.com and developer.mozilla.org. Each has a scripted replay test against the live site. heyo turns retargeting off by itself when the log stops passing or cannot be read, after a wrong click that could not be undone, or after more than one wrong click in a week.
- **Launch files.** `npm run package` writes the zip the Chrome Web Store takes. [store/listing.md](../store/listing.md) has the listing text, the permission justifications and the data disclosures. The screenshots and the promo tile are in `store/`. The privacy policy is [privacy.md](privacy.md).
- **The Mac experiment.** `mac/` holds the feasibility experiment the plan asks for before any Mac app. It builds, and its unit tests pass. It has not been run: it needs Accessibility permission, and no shell on this machine that I can start has it.

## What the numbers do and do not show

Every gate result so far is on generated clicks. The synthetic and scripted logs show that the capture, the scorer and the decision hold together, and that the decision clears the gates under the generator's stated guesses. They say nothing about how often a real person misses, or which control they meant. The plan's first stop condition, a miss rate of at least 0.5% of clicks and 3 a day over two weeks, can only be judged on a real log.

## What is left

- Two weeks of real use in shadow mode, and about 300 hand-reviewed fires. Then the gates on that log decide whether retargeting goes on. If the decision misses a gate there, the agent loop is the next step, from about 500 labeled misses.
- The Mac experiment has not been run, so there is no go or no-go for a Mac app, and no Mac app beyond the experiment. The plan puts the experiment first for that reason: if hit tests are too slow or the event tap cannot rewrite a press, the Mac app is not worth building as planned. Shadow mode and retargeting for the Mac come after a go.
- More sites on the allowlist. Each needs its own replay test.
- A capture that tells a covered control from a round one pressed at its corner, and that sees a page change just before a quick press. `docs/decisions.md` has both under "Decision".

## What needs Krish

1. **Load the extension in your own Chrome and use it for two weeks.** `npm ci && npm run install:chrome`, then the three steps it prints. Mark the fires on the Review tab as they come.
2. **Accessibility permission for the Mac experiment.** In System Settings, Privacy & Security, Accessibility, turn on the terminal app you run it from. Then `cd mac && swift run -c release heyo-feasibility all --out ../docs/mac-feasibility-result`. It takes a few minutes and moves the pointer while it runs. [mac-feasibility.md](mac-feasibility.md) says how to read the result.
3. **A Chrome Web Store developer account**, which has a one-time fee. Run `npm run package`, upload `dist/heyo-extension-<version>.zip` and paste the fields from [store/listing.md](../store/listing.md). Start it as Unlisted.
4. **A release, when you want one.** `git tag v0.1.0 && git push origin v0.1.0` publishes the zip on GitHub, for installing without Node.
5. **An Apple Developer ID certificate**, only if the Mac experiment says go and a Mac app gets built. Nothing needs it today.
