# Shadow capture

In shadow mode heyo watches plain left clicks and changes nothing. When a click lands on empty space with a control within 30 px, it logs the nearby controls, the target it would have picked, whether the page reacted, and where the user's next press went. Clicks that hit a control, text or a canvas are counted and otherwise left alone.

## Sub-features

- `near-miss-record` logs an empty-space click with its candidates, cursor path and would-be decision.
- `follow-up` attaches the next press within 1.5 seconds to the record.
- `reaction` flags a click the page reacted to by DOM change, focus, selection, scroll or navigation.
- `hit-ignored` counts a real hit and logs no record.
- `counts` keeps clicks per site per day as the miss rate's denominator.
- `privacy` never logs a field's value or text from an editable region.

## How to get to it (user POV)

- Load the extension and browse. There is nothing to turn on.
- Click just beside a button on any page, then click the button.

## Driving it with verify.mjs

Preconditions:

- `npm run build` has run.

- **Near miss, retry, hit and far click.** Run `npm run verify -- run shadow-capture`. The drive clicks 4 px right of `Save` on `capture.html`, then `Save`, then `Share`, then far from everything. The transcript shows `logged candidate: Save at 4 px`, `would-be decision: {"action":"retarget","candidate":0}`, `page reacted: false`, a follow-up with `"kind":"control","candidate":0`, counts of 4 clicks, 2 hits and 2 ignored empty clicks, `DOM mutations seen by the page during the drive: 0`, and `the page markup is unchanged after four clicks`.
- **Proof.** `result.json` is the exported log read back from the service worker. `1-near-miss.png` shows the page after the near miss.
- **Other cases.** `npx playwright test e2e/capture.spec.ts` covers reactions, delegated root listeners, shadow roots, iframes, drags, long presses and the privacy rules on fixture pages. Run it for a change to any of those.

## Gotchas

- The content script waits 50 ms after a click for a page reaction. Read the log at least 100 ms after a click.
- A record needs a `click` event. `page.mouse.down()` without `up()` logs nothing.
- Clicks with a modifier key, non-left clicks and synthetic clicks (`element.click()`, `locator.dispatchEvent`) are ignored by design. Use `page.mouse`.
- Fixture coordinates assume the default 1280 by 800 viewport.
- A follow-up is matched only within the same frame.
- `page.screenshot()` hides the text caret by editing the inline style of every input, which changes the page markup. Pass `caret: 'initial'` when a drive also checks that the page is unchanged.
- Clicking a button focuses it. The next empty-space click takes that focus away, which is logged as `blurred` and is not a page reaction. Leaving a text field is a reaction.
