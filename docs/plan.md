# Forgiving clicks feasibility plan

## Verdict

Build the Chrome extension. Treat the macOS app as a maybe until the extension has data.

The mechanism is sound. Chrome already retargets touch taps to the best nearby clickable node ([touch_adjustment.cc](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/page/touch_adjustment.cc)). What nobody knows is whether mouse misses onto empty space are common enough to matter, and shadow mode answers that in two weeks. Confidence is high for shadow mode, medium for retargeting under the false-retarget ceiling, and low to medium for the Mac app.

Two limits apply from day one. The extension cannot fix the quote's example, because a window's close button belongs to the OS. Replayed clicks are synthetic, so `event.isTrusted` is false ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)) and pages that check it ignore them.

## Corrections to the gathered facts

- The Bosworth quote comes from his September 2026 interview ([video](https://www.youtube.com/watch?v=4Uco2KCmwD0), about 18:45). Jake Mor's 229 builds come from his launch post ([post](https://x.com/jakemor/status/2122551786045059205)). I found no source for the 1 to 1.5 second tap timeout or the Homerow typing lag (unverified).
- macOS "snap to items" did not check out. Apple's [macOS 27 Pointer Control page](https://support.apple.com/en-in/guide/mac-help/unac899/27/mac/27) lists no snapping option.
- "No published baseline" is partly wrong. [Input Observer](https://depts.washington.edu/acelab/proj/io) (CHI 2012) computed pointing error rate from a week of everyday use by 12 people. I could not get its number, so shadow mode still has to produce one.

## Chrome extension mechanics

The extension never cancels the real click. It lets the click land and replays on the target only if it saw no page reaction.

- Interception. A [content script](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) injected at `document_start` in all frames listens in the capture phase on `window`. It handles plain left clicks only.
- Empty space versus a hit. If any element in `event.composedPath()` looks clickable, or is a canvas, video, iframe or editable region, or the pointer is over text, the click is a real hit. Otherwise any DOM mutation, focus change, selection change, scroll or navigation from `pointerdown` until about 50 ms after `click` counts as a page reaction. Watching starts at `pointerdown` because focus moves on the press, before `click` fires ([UI Events](https://www.w3.org/TR/uievents/event-algo.html#handle-native-mouse-down)). This is a heuristic. A handler can change internal state or start async work without any of these signals, and the replay would then cause a second action.
- Finding clickables. It calls `document.elementsFromPoint` on a ring of points within 12 px and looks for native controls, ARIA roles, `tabindex` and computed `cursor: pointer`. A main-world script wraps `addEventListener` to record click listeners. React attaches handlers at its root container ([React 17](https://legacy.reactjs.org/blog/2020/08/10/react-v17-rc.html)), so there the cursor and role signals do the work.
- Replay. It dispatches a synthetic pointer and mouse sequence ending in `click`. Links follow their default action. Popups should open because Chrome keeps user activation as per-frame state for about a second after the real press ([Chrome](https://developer.chrome.com/blog/user-activation)). File pickers need a test in week one (unverified).

## The decision

The signals are distance to the candidate's nearest edge, the margin over the runner-up, and whether the last 300 ms of cursor path slowed toward it.

It refuses when the nearest candidate is over 12 px away, the runner-up is less than twice as far, the page reacted, the press was a drag or long press, the tab lacked focus, or the target looks irreversible, such as delete, pay or send.

The first click of a double-click can't be recognized within 50 ms, so a replay may already have fired. Shadow mode counts how often a would-be fire is followed by a second press within the double-click interval. If that is common, delay the replay until the interval passes and check that the delay still feels acceptable.

## Intentional empty-space clicks

The real click always lands first, so closing a menu, dismissing a popup and leaving a text field happen exactly as today. Each of those changes the DOM or focus, and that reaction normally cancels the retarget. Figma, Docs and Maps draw in canvases and iframes, which count as real hits.

Two gaps remain. A deliberate click that does nothing and lands beside a button is guarded only by the distance cap and cursor path. A page that reacts without a visible signal can get a second, unwanted action from the replay. Both are why retargeting starts on a reviewed allowlist.

## Shadow mode and the metric

A labeled miss is an ignored empty-space click followed within 1.5 seconds by a real hit on a clickable element within 30 px. The second click is a proxy for the true target, not proof. A deliberate click followed by a nearby action can look like a miss, and a real miss the user never retried looks like no miss.

- Proxy recovery rate is the share of labeled misses where the logic picked the element the user then clicked. Target 50% or more.
- Verified wrong-target rate is the safety number. The user hand-reviews a random sample of all would-be fires, including ones with no retry, from a short log of what was under the pointer, and marks each right or wrong. Ceiling 1% of fires.
- The ceiling needs enough evidence. Zero wrong targets across about 300 independent reviewed held-out fires puts the one-sided 95% upper bound near 1%. Fewer reviewed fires means inconclusive, not pass, and each wrong target found raises the number needed.

Once retargeting is on, the correcting click disappears, so keep 10% of fires in shadow as a control. Load the extension unpacked, since all-sites access slows store review ([Chrome Web Store](https://developer.chrome.com/docs/webstore/review-process)).

## The agent loop

The decision is a pure function from logged features to a target or a refusal. The agent edits that module, runs a scoring script over the logged corpus and keeps changes that raise recovery under the ceiling.

Four things keep it from gaming the metric. The scorer and labels are read-only and outside its workspace. Data is split by site and by week, and the agent never reads the test split. The ceiling is a pass or fail gate. A lint rejects hostnames, selectors and per-example constants.

One person may log only a handful of labeled misses a day (my guess), so start the loop after about 500. Before that, 229 builds would memorize the corpus.

## The macOS app

An active event tap catches left mouse presses, and [`AXUIElementCopyElementAtPosition`](https://developer.apple.com/documentation/applicationservices/1462077-axuielementcopyelementatposition) hit-tests the click point and a ring around it. The tap rewrites the event's location so the app receives a real click (unverified). A press is rewritten when it happens, before anyone knows whether a drag follows, so rewriting is only usable if a drag that starts at a near miss still starts where the user pressed. The experiment checks that.

- A sandboxed app cannot use the Accessibility privilege ([Apple DTS](https://developer.apple.com/forums/thread/780626)), so it ships outside the Mac App Store with Developer ID.
- It cannot let the click land and watch for a reaction, so it decides first. A tap callback can only pass, change or delete an event, not pause it ([Apple](https://developer.apple.com/documentation/coregraphics/cgeventtapcallback)). So for a candidate miss it would drop the press and post the press and release on the target once the user lets go (unverified). That delays the click by the user's own press time, and movement in between has to become a normal drag again. A title-bar drag that starts beside the close button is the hard case. Run this as a small experiment before committing to Mac retargeting.
- Accessibility queries block on the target app, and macOS disables slow taps ([example](https://github.com/acsandmann/rift/issues/628)). Use a 30 ms query timeout and pass the click through on failure.
- Electron builds its accessibility tree only on request, at a [performance cost](https://www.electronjs.org/docs/latest/tutorial/accessibility).

## Main risks and stop conditions

- Stop after two weeks of shadow mode if labeled misses are under 0.5% of clicks or under 3 a day.
- Stop before turning retargeting on if no rule reaches 50% proxy recovery while meeting the verified 1% ceiling with enough reviewed fires.
- Before turning retargeting on, script a replay test for each allowlist site. A site stays on the list only if the intended action happens exactly once, counting pages that reject synthetic events.
- Turn retargeting off after any wrong irreversible action, or more than one noticed wrong click a week.
- Narrow the extension to an allowlist if pages ignore over 10% of replays.
- Drop the Mac app if processing adds over 30 ms on top of the press itself, if buffered presses break drags, or if probing lags Electron apps.

## Rough phases

1. Weeks 1 to 3. Shadow extension, loaded unpacked. Measure the miss rate, then go or no-go.
2. Hand-tune the decision, start the agent loop at about 500 labeled misses, review about 300 held-out fires, test replays on each allowlist site, then turn retargeting on for that allowlist.
3. Mac app in shadow mode, then retargeting.
