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
- Clearing a text selection by clicking empty space stays a reaction, though Chrome does it on its own like the blur above. Clicking away to deselect is one of the deliberate empty-space clicks the plan wants left alone, and the plan lists selection change as a reaction.
- A selection change is a reaction only when the visible selection changes. Chrome moves an invisible caret on the first click outside a field, and that fires `selectionchange`. The plan now says so.
- Ring sampling uses the topmost element at each point (`elementFromPoint`), not every element under it. A click at that point would reach only the topmost one.
- A click listener marks an element as clickable only when the element is not the page root, wraps no other control, and covers under half the viewport. A listener that fails those tests is event delegation.
- A pointer cursor is inherited, so a run of nested elements that all show it is one control, named by the outermost.
- The main-world script wraps `addEventListener` in a Proxy. The function keeps its name and length and still prints as native code, but a script that compares the printed text with a real native function can tell. heyo does not try to hide further.
- The content script asks the main-world script about listeners with a DOM event whose name is random per page load, handed over before any page script runs. Once the name is handed over nothing answers a later request for it, so a page cannot use the query to detect the extension.
- The main-world script also wraps `attachShadow`. An event from inside a closed shadow root reaches the window naming only the host, so a listener query about a node in there cannot be answered from the window. The wrapper puts a listener for a second query event on each closed root as the page creates it. A closed root made without `attachShadow`, from a declarative template, has no such listener and its nodes are answered "no listener".
- The main-world script takes the built-ins it needs (`Reflect.apply`, the `WeakSet` and `Set` methods) before any page script runs, so a page that patches them cannot break its own `addEventListener` calls.
- A listening wrapper can still count as one control when its descendant controls sit behind more than one shadow root, which hides misses inside that wrapper.
- A node in an open shadow root nested inside a closed one is answered "no listener". Its query event is the ordinary one, and the window sees only the outer host. A control there that is known only by its listener is logged as empty space.
- A removed click listener is not forgotten. The error goes toward calling a click a real hit, which is the safe side.
- The text test measures at most 1,200 text nodes and inline children under the pressed element, testing each as it reaches it. Past that, from about line 170 of a highlighted code block, a press on text is logged as empty space. The same limit applies to any pressed element with more than 1,200 child nodes, such as a very long list with loose text in it.
- The text test also counts text inside a paragraph's inline children, such as a bold run or a span, up to four levels deep. A press between lines goes to the paragraph, and on many sites the paragraph's words all sit in such children. An inline child that is a control, such as a link, is left out, so the gap beside a link stays empty space. An inline child whose box is more than a line's height from the press is skipped without reading its text, which is what keeps a press in a code block of thousands of tokens cheap.
- A press between two lines of a paragraph is a press on text. A letter's box is as tall as the font, and body text is set with lines 1.5 to 1.7 times that, so each box is grown to the full line height before the test. Without this a quarter of every paragraph would be empty space, right beside its links.
- Labels and the text test follow the tree the user sees. Text slotted into a web component, or kept in its shadow root, names the control. Text inside `style` and `script` elements is skipped.
- When Chrome moved focus on its own, an attribute change that only mirrors focus is not a DOM change for the reaction watch. That is an attribute with "focus" in its name, or a class change whose added and removed names all have "focus" in them. Angular's and React Aria's focus tracking write such marks on the focused element or a wrapper, and counting them would undo the `blurred` rule on those sites. Any other attribute, such as `aria-expanded`, still counts, so a menu that closes when its button loses focus is a reaction.
- An attribute written back with the value it already had is not a DOM change. Code often does this, for example by removing a class that was not there.
- Leaving a text field stays a reaction, though Chrome does that on its own too. The plan names it as a deliberate empty-space click that must go on working as today, and retargeting a click that was meant to commit a field would be a wrong action. `leftField` records it apart from other focus changes, so the number of misses hidden this way can be counted from the log.
- A press on a control the page removes during the press, as some menus do, is counted as a hit at the release. Chrome sends no click for it.
- `site` is the hostname of the top-level page, also for clicks inside iframes, read from `location.ancestorOrigins`.
- A follow-up press is matched only within the same frame.
- Clicks with a modifier key are not counted at all. The plan covers plain left clicks only.
- Records live in IndexedDB under the extension's origin. The service worker writes one message at a time so a follow-up cannot land before its record.
- The extension asks for no permissions. It needs only its content scripts.
- A label is the page's own name for a control, cut to 40 characters. It never includes a field's value, text inside an editable region or an element with a textbox role, or text shown with a text cursor, which is how code editors draw what the user types. A password field is always logged as "password field".
- A page can repeat typed text in a control, such as a button that reads "Search for ...". Any run of 6 characters a label shares with what a field on the page holds right now is blanked. The fields are text inputs, text areas, editable regions and elements with a textbox or searchbox role, in the document and in every shadow root. A dropdown is not such a field, native or built from a div with a combobox role, because what it shows is a choice from a list.
- The typed-text check reads up to 20,000 characters of each field and up to 300 fields. When a field is longer or there are more fields, the check cannot cover everything, so every label logged for that press is blanked whole and marked `redacted`.
- The same holds less visibly for shadow roots: the search for them stops after 8 ms, and a field in a root it did not reach is not checked. That takes a page with tens of thousands of elements.
- A typed value shorter than 3 characters, or one the page reformats before repeating it, such as an amount with separators, is not blanked.
- The name of a file chosen in a file field counts as typed text. Up to 300 names per field are read. With more, as when a whole folder is picked, every label logged for that press is blanked whole.
- Blanking costs labels on some pages. On a search results page the query stays in the search box, so result titles that share a word with a short query are blanked and refused. In an editor where every block is an editable region, short headings blank their words out of other labels. The miss rate is not affected. Those pages just log few would-be fires that a reviewer can judge. Hidden inputs, checkboxes, radio buttons and the like are not read: their values are the developer's, and often match the label. A whole word of 3 or more characters from a typed value of at most three words is blanked too, so a first name out of "Ana Lopez" does not get through. Words from longer typed prose are left alone, because ordinary words would blank most labels on the page. The matching run is blanked, and the candidate is marked `redacted`. The decision refuses a redacted candidate, because it cannot check a label it cannot read.
- What this does not cover: text the user wrote earlier that the page now shows as its own content, such as the subject of a sent message used as a link. That text can appear in a label. The log stays in the browser unless the user exports it.
- The reaction watch observes every shadow root in the document, not only those on the click's path, because a click outside a component can close a menu inside another one. The search for shadow roots stops after 8 ms. Closed roots are looked up only on custom elements.
- The candidate search samples 136 points on 8 rings. Each sample is a hit test, and hit tests are the main cost on a page with many elements. That spacing still finds any control at least 6 px across.
- Measured on this machine, handling an empty-space press takes 3 to 4 ms on a page of 2,000 elements, 6 to 14 ms at 20,000 to 50,000, and 14 to 19 ms where many controls sit near the click, such as a grid of 2,400 clickable cells or a 9,000-row list with a button on each row. The cost follows the number of nearby controls more than the page's size. Presses that hit something skip all of this. A press on text has to find the text first: under 1 ms in a paragraph, and 1 to 6 ms in a highlighted code block, more the further down the block the press is. A press on the blank part of a 2,000-line code block takes about 25 ms, most of it Chrome's own hit tests, which slow down inside one very large block of text. The first pointer move after a second of rest costs up to 8 ms more on a page with thousands of custom elements, while the background watch finds the shadow roots.
- A follow-up on a control nested inside a candidate counts for the candidate, even when the nested control does something different. This only arises at the outer edge of a list, because a miss between rows lands on a row.
- A control's name also comes from `aria-labelledby`, read within the control's own tree and blanked like any other label.
- A label is disabled when its control is, including through a disabled fieldset.
- Every record carries the extension's version, so records can be told apart if the capture code changes during the measurement. The version is the one in `package.json`. A change to the capture code that ships while a measurement is running has to come with a bump, or its records cannot be told from the earlier ones.
- A label and the control it activates are one target. When both are near a click, only the nearer is logged as a candidate, and a follow-up press on either counts for it.
- A read-only input is not a text field when focus leaves it. The user cannot type in it, and dropdown libraries keep focus in one after a pick. Its value still counts as typed text when labels are blanked.
- On Angular forms the first click away from a control the user just used is a reaction, because Angular marks the control touched on its first blur with a class that does not say focus. It happens once per control per page load.
- A press on a scrollbar is not logged. Chrome sends no click for it. Only a box that scrolls has a scrollbar, so an inline element, which reports no inner size, is not taken for one. So a press on the gap inside a custom element, or on the padding of a chip, is empty space.
- The page root and the body are never tested for a scrollbar. They report the window's size as their inner size and the document's as their outer size, so on a scrolled page every press on them would look like a scrollbar press. That matters wherever the press falls outside the body box, such as the margin beside a centered body. On a page where the body is its own scrolling box, a follow-up press on the body's scrollbar is logged as empty space.
- A scrollbar is found by comparing a box's outer and inner sizes, which assumes equal borders on both sides. On a box with unequal borders a scrollbar press can be logged as a follow-up on empty space.
- The background watch behind `churn` skips a write that leaves an attribute as it was, as the reaction watch does, so a page that sets the same style on every frame is not flagged.
- Leaving a dropdown is not a reaction. A dropdown commits its value when the user picks, so clicking away commits nothing, and focus stays on it after a choice.
- `scale` logs screen px per CSS px, the display's scale times the page zoom. Every distance in the log is in CSS px, and a log cannot be corrected for zoom afterwards without it.
- A tab stop marks an element as a control only when the element is one control. A scrollable region with `tabindex="0"`, such as a code block, is not one.
- `mutations` counts the DOM changes during the watch and how many touched the clicked element, its ancestors or a candidate. A change on `html` or `body` does not count as near, because they are ancestors of every click and some libraries mark them on every press. `reacted` stays a yes or no as the plan defines it, and the counts let a later analysis draw the line elsewhere.
- An ignored click with nothing found nearby is held for 1.5 seconds and logged only if the user then hits a control within 30 px. The search cannot see every control, such as one that shows a pointer cursor only under the pointer, and those misses belong in the miss rate.
- A pending click stops waiting for its follow-up when the window loses focus. A press inside an iframe or another window is invisible to this frame, so the next press it sees is not the retry.
- The decision refuses a control with no name. Its label cannot be checked for an irreversible action, and a reviewer cannot judge it.
- In an iframe the tab's focus is read from the top page when it is the same origin, and at the click otherwise. The frame's own document gains focus only after the press.
- `churn` records whether the DOM was already changing in the 300 ms before the press. A page that changes on its own makes every click look reacted to. Such clicks stay out of the labeled misses, as the plan defines them, and the miss-rate report counts the ones followed by a nearby retry separately as masked.
- The background watch behind `churn` runs only while the pointer is moving and stops after a second of rest, so an idle or typing-only page pays nothing for it.
- A follow-up that hits a logged candidate reuses the distance measured at the first click. If the page scrolled in between, or a logged candidate has moved, an unlogged control gets no distance, because the two positions no longer line up. Candidate positions are compared directly, since a scroll inside a shadow root or a scrolling box may send no event this script sees.
- Leaving a text field is detected by comparing the focused element before and after, not from the focus event, because a focus event from inside a closed shadow root names only the host. The record keeps it as `leftField` as well as in `reaction.focus`, so a later analysis can count clicks that came right after typing.
- The reaction watch also listens for scrolls on every shadow root, since a scroll event does not leave the root it happens in. The background watch behind `churn` observes shadow roots too.
- A press that gets no click within the settle time, such as one released outside the window, is dropped so its watch stops.
- A candidate that left the document matches a follow-up on a control with the same tag, label and box, when exactly one candidate fits. Pages re-render and replace nodes.
- A press on a disabled control is counted at the release, since Chrome sends no click for it.
- Record ids come from `crypto.getRandomValues`. `crypto.randomUUID` does not exist on plain HTTP pages.
- Labels never include a field's value or text inside an editable region. A password field is always logged as "password field".

## Review page

- The toolbar button opens the review page in a tab. There is no popup, so the extension has one page to learn.
- Fires are reviewed in the order of a hash of the record id. That order is random with respect to time and site and is the same on every visit, so reviewing from the front is reviewing a random sample of all would-be fires.
- The review never shows whether the user retried. The verified wrong-target rate has to be independent of the proxy label.
- A review judges the control the bundled decision picks now, not the one logged at click time. After a decision update the page asks again about any click whose pick changed.
- Keys are `Y` for right, `N` for wrong, `U` for not sure and `Z` to go back. The question is worded as yes or no so the keys match it.
- Keys are ignored for about a quarter second while the verdict stamp shows, and for another 300 ms after the next click comes up, so a double tap cannot mark a click the reviewer has not seen, however late the second tap is. With reduced motion the stamp does not move, and both waits stay. A held Enter on a focused answer marks once.
- The review stays mounted while the numbers show, so its place and the way back to earlier marks survive a look at the numbers. Its keys do nothing meanwhile. The way back holds only clicks that are still in the log.
- A mark that cannot be stored leaves the click on screen with a message, and the reviewer marks it again.
- The question and the three answers sit right under the name, and the details come after. The block that holds the name has one height for every click, and a long name is set in smaller type until all of it fits in two lines. The size starts from the name's length and is then measured, because wide characters take twice the room their count suggests. So the answers are in the same place for every click, and no name is cut. The drawing is a square sized to what the window leaves, with its legend under it, or below the answers when the window is under 640 px wide. In a window at least 560 px wide and 600 px high a mark needs no scrolling. In a smaller one the next drawing is scrolled into view.
- While a mark is being stamped the screen shows the click as it was before the mark. A fresh mark does not flash the filled button or the line that says what the click was marked.
- The distance label in the drawing moves to one side when a neighbour sits where it would go, so it never covers a neighbour's name. With neighbours on every side it is left out, and the distance is in the text beside the drawing.
- `Z` is never locked out, because going back marks nothing. During the stamp it keeps the click being marked on screen. During the next click's look time it goes back at once. A dropped `Z` would send the reviewer's next key to the wrong click.
- A mouse click on an answer gives up focus afterwards. Chrome leaves focus on a clicked button without showing a ring, and Space, pressed to scroll, would mark the next click. An answer reached with the keyboard keeps its focus.
- A failed export or delete says so and leaves the log as it was. A store that failed to open is opened again on the next try.
- The note above the export says what the capture does with field contents: it looks at them to blank names that repeat them and stores none of them. It also says a name can still hold something personal.
- Every number shown beside a limit gets as many decimals as it takes to tell it from that limit. At 299 marks with none wrong the bound reads 0.997%, and 124 recovered of 250 reads 49.6%.
- The review screen shows only how many fires are marked and how many wait. The count the gate needs and the wrong marks are on the numbers page. On the review screen one wrong mark would visibly raise the target from 299 to 473, which is a reason to press something else.
- The three answers are drawn with the same weight. A filled button marks only what the reviewer chose earlier, on a click they came back to.
- With few marks the wrong-target bound can sit over 1% and still come down as marks come in. The page words that as "Fail so far" until 299 fires are marked, the sample the plan asks for with none wrong, and as "Fail" from then on.
- A name of exactly 40 characters gets an ellipsis whether or not the capture cut it. The log does not say which, and a cut name shown as whole would be the worse mistake.
- The numbers page lists the fires marked not sure. They are left out of the wrong-target rate, and they are the hard cases, so a large count has to be visible.
- An export reads the store again first, so it holds clicks logged since the page was opened.
- The drawing shows 56 px on each side of the click at a fixed scale, so distances look the same from one click to the next.
- The page uses one bundled typeface, Recursive (OFL). The extension makes no network calls, so the font ships inside it.
- Preact renders the page. It is 4 KB and keeps the review state readable.
- Deleting the log takes two clicks, and the second button names how much it deletes. `Keep the log` appears where the first click landed and the delete button takes no click for 600 ms, so a double-click cannot delete anything.

## Scorer and synthetic log

- The scorer runs the decision in a child process under Node's permission system, with read access to its own bundle only. It is sent click features and nothing else. That enforces by construction what the plan asks the lint to enforce by inspection.
- The scorer always uses the repo's own `src/core`, also for a decision in another folder with its own copy beside it.
- The repo needs Node 26. Node's permission system covers the network only in recent versions, and on an older one a decision could open a socket. The scorer tests that with a probe process before it runs a decision, and refuses to run if the probe gets through.
- The decision's process starts with an empty environment. The permission system does not hide environment variables, and a decision could hand a token back as the text of its reason.
- When several exports are scored together, those that share a record are snapshots of one browser's log, and the later one's click counts win. Those that share none are logs of different browsers, and their counts are added. Without that, two browsers used on the same days would have one's clicks dropped and the miss rate read too high.
- A synthetic record's id carries a hash of the generator's options. Two logs made with the same seed and different settings can then be scored together without one click replacing another.
- The bundler refuses any import a decision makes other than its own `.ts` files and `src/core`. The permission system only guards the running process, and an imported log file would be read at bundle time, before it starts.
- A decision that returns an unknown candidate, an opaque region or a malformed answer fails the run. A silent fallback to "refuse" would hide a broken rule.
- The held-out split is a fixed quarter of the sites, by a hash of the site name, plus the last 30% of the weeks. Holding out the latest weeks matches how the decision will be used, on clicks made after it was tuned.
- `gates` exits 0 only when both retargeting gates pass. The shadow-mode stop condition is reported but does not change the exit code, because it is judged once on the real log and not on every run.
- The synthetic generator's behavioral numbers are guesses and live in one `ASSUMPTIONS` object. The share of deliberate clicks that land beside a control is 0.5%. The synthetic wrong-target rate follows almost directly from it.
- Synthetic review marks cover every candidate of every record, so any decision can be scored without new reviews.
- In the synthetic layouts many rows of controls touch with no gap, and a lone control is the most common scene. Real toolbars and lists mostly have touching hit boxes, so a miss between two neighbors is rarer than a miss off the end of a row.

## Agent loop

- The agent command is any shell command, run once per round in the workspace. The loop does not depend on one agent product.
- The agent runs under macOS `sandbox-exec` with a profile that denies reads of the log files and the runner's folder, and denies writes to the repo. The plan asks for a scorer and labels that are read-only and outside the workspace, and a test split the agent never reads. The sandbox enforces both.
- The agent gets the train split and its review marks. Acceptance is judged on the same split. The held-out split is judged once, after the last round, and the agent is never told the result, so it cannot tune against it round by round.
- "Better" puts the ceiling first, as the plan makes it a pass or fail gate. Above the ceiling a lower upper bound on the wrong-target rate is better. Under it, higher recovery is better.
- A change that is not better is undone, so every round starts from the best decision so far.
- The lint is an AST check, not a text search. It limits numbers to 3 significant digits, strings to short lower-case keywords, and bans hostnames, selectors, URLs, paths, I/O, time and randomness. It also type-checks the decision against the repo's core, so reading a field the features do not hold is an error.
- CI runs the lint on `src/decision`, so a hand edit is held to the same rules as the agent.
- `--apply` copies the best decision into `src/decision` only when both held-out gates pass. A person still reads the diff before it ships.
