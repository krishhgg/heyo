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

## Log schema and metrics

- The log keeps candidates out to 30 px, although the decision only fires within 12 px. 30 px is the labeled-miss radius, and the agent loop can only test a rule on features the log holds.
- A candidate is either a control or an opaque region (canvas, video, iframe). Opaque regions are never targets. They are logged because the user may have aimed at something inside one, so the decision treats a near one as a competitor.
- The decision sees `ClickFeatures` only. The record's site, time and id live outside it, so a rule cannot key on them.
- The 30 px in the labeled-miss definition is measured from the first click point to the nearest edge of the control the follow-up click hit, not between the two click points. The user aimed at the control, so its edge is what the miss fell short of.
- A review judges one pair of click and control. When the decision changes and picks a different control for the same click, the old review does not carry over.
- A fire marked unsure counts as neither reviewed nor wrong. The scorer reports the count so a large number of them is visible.
- The wrong-target gate uses the exact one-sided Clopper-Pearson bound at 95%. It passes when the upper bound is under 1%, which takes 299 reviewed fires with none wrong and 473 with one wrong. It fails when the lower bound reaches 1%. Anything between is inconclusive.
- The recovery gate is inconclusive below 30 labeled misses. The plan sets no minimum, and 50% of a handful of misses is noise.
- "Misses a day" divides by days on which heyo saw at least one click, so a day away from the computer does not count against the stop condition.
- The two weeks of shadow mode are calendar days from the first logged day, used or not. Only the "misses a day" figure divides by active days.
- A double press is a second press within 500 ms and 5 px of the first.
- The first decision treats labels with social actions (like, follow, vote) as irreversible along with delete, pay and send. They notify other people and cannot be taken back. The word list is English only.
- The first decision uses the cursor path only to refuse. It refuses when the cursor started nearer the control than it ended, unless it came from elsewhere and crossed the control, which is an overshoot.

## Shadow capture

- A press is classified where it lands, at `pointerdown`, not at `click`. The press point is what the user aimed at, and the same classification serves the first click and the follow-up.
- Candidates are collected at the press too, before the page can handle anything.
- A focus change is a reaction only when focus leaves a text field, or lands somewhere other than a container around the click. Chrome takes focus off the last-clicked button or link on any click outside a control, and gives focus to a focusable container around the click, such as a dialog with `tabindex="-1"`. Counting either would hide most real misses, because most clicks follow a click on a button or link. The log keeps the fact as `blurred`. This narrows the plan, and the plan now says so.
- A selection change is a reaction only when the visible selection changes. Chrome moves an invisible caret on the first click outside a field, and that fires `selectionchange`. The plan now says so.
- Ring sampling uses the topmost element at each point (`elementFromPoint`), not every element under it. A click at that point would reach only the topmost one.
- A click listener marks an element as clickable only when the element is not the page root, wraps no other control, and covers under half the viewport. A listener that fails those tests is event delegation.
- A pointer cursor is inherited, so a run of nested elements that all show it is one control, named by the outermost.
- The main-world script wraps `addEventListener` in a Proxy. The function keeps its name and length and still prints as native code, but a script that compares the printed text with a real native function can tell. heyo does not try to hide further.
- The content script asks the main-world script about listeners with a DOM event whose name is random per page load, handed over before any page script runs. Once the name is handed over nothing answers a later request for it, so a page cannot use the query to detect the extension.
- The main-world script takes the built-ins it needs (`Reflect.apply`, the `WeakSet` and `Set` methods) before any page script runs, so a page that patches them cannot break its own `addEventListener` calls.
- A removed click listener is not forgotten. The error goes toward calling a click a real hit, which is the safe side.
- A scrollbar is counted as a real hit.
- `site` is the hostname of the top-level page, also for clicks inside iframes, read from `location.ancestorOrigins`.
- A follow-up press is matched only within the same frame.
- Clicks with a modifier key are not counted at all. The plan covers plain left clicks only.
- Records live in IndexedDB under the extension's origin. The service worker writes one message at a time so a follow-up cannot land before its record.
- The extension asks for no permissions. It needs only its content scripts.
- A label is the page's own name for a control, cut to 40 characters. It never includes a field's value, text inside an editable region or an element with a textbox role, or text shown with a text cursor, which is how code editors draw what the user types. A password field is always logged as "password field".
- A page can repeat typed text in a control, such as a button that reads "Search for ...". Any run of 6 characters a label shares with the current value of an input or text area on the page, or of the focused field inside a shadow root, is blanked, and the candidate is marked `redacted`. The decision refuses a redacted candidate, because it cannot check a label it cannot read.
- What this does not cover: text the user wrote earlier that the page now shows as its own content, such as the subject of a sent message used as a link. That text can appear in a label. The log stays in the browser unless the user exports it.
- The reaction watch observes every shadow root in the document, not only those on the click's path, because a click outside a component can close a menu inside another one. The search for shadow roots stops after 8 ms. Closed roots are looked up only on custom elements.
- The candidate search samples 136 points on 8 rings. Each sample is a hit test, and hit tests are the main cost on a page with many elements. That spacing still finds any control at least 6 px across.
- Measured on this machine, handling an empty-space press takes 3 to 4 ms on a page of 2,000 elements, 6 to 14 ms at 20,000 to 50,000, and about 14 ms on a grid of 2,400 clickable cells. Presses that hit something skip all of this.
- A tab stop marks an element as a control only when the element is one control. A scrollable region with `tabindex="0"`, such as a code block, is not one.
- `mutations` counts the DOM changes during the watch and how many touched the clicked element, its ancestors or a candidate. `reacted` stays a yes or no as the plan defines it, and the counts let a later analysis draw the line elsewhere.
- An ignored click with nothing found nearby is held for 1.5 seconds and logged only if the user then hits a control within 30 px. The search cannot see every control, such as one that shows a pointer cursor only under the pointer, and those misses belong in the miss rate.
- A pending click stops waiting for its follow-up when the window loses focus. A press inside an iframe or another window is invisible to this frame, so the next press it sees is not the retry.
- The decision refuses a control with no name. Its label cannot be checked for an irreversible action, and a reviewer cannot judge it.
- In an iframe the tab's focus is read from the top page when it is the same origin, and at the click otherwise. The frame's own document gains focus only after the press.
- `churn` records whether the DOM was already changing in the 300 ms before the press. A page that changes on its own makes every click look reacted to. Such clicks stay out of the labeled misses, as the plan defines them, and the miss-rate report counts the ones followed by a nearby retry separately as masked.
- The background watch behind `churn` runs only while the pointer is moving and stops after a second of rest, so an idle or typing-only page pays nothing for it.
- A follow-up that hits a logged candidate reuses the distance measured at the first click. If the page scrolled in between, an unlogged control gets no distance, because the two positions no longer line up.
- A candidate that left the document matches a follow-up on a control with the same tag, label and box, when exactly one candidate fits. Pages re-render and replace nodes.
- A press on a disabled control is counted at the release, since Chrome sends no click for it.
- Record ids come from `crypto.getRandomValues`. `crypto.randomUUID` does not exist on plain HTTP pages.
