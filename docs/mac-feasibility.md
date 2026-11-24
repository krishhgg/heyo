# Mac feasibility experiment

## Result

No-go as built. It ran once, on 23 November 2026, on the owner's MacBook, from Terminal, which already had Accessibility permission. It measured nine apps, three of them Electron apps. [report.md](mac-feasibility-result/report.md) and [report.json](mac-feasibility-result/report.json) hold the full output, with one app's name withheld.

- **The ring search is too slow in three apps.** At the 95th percentile it took 34 ms in Finder, 42 ms in ChatGPT and 50 ms in Tailscale, over the plan's 30 ms limit. A single hit test stays under 1 ms at the 95th percentile in every app. The ring search makes 137 of them one after another, and the sum is what crosses the limit. Each app got 20 ring searches in this one run, so its 95th percentile is the second-slowest of them. Tailscale is over the limit even at the median, at 36 ms. The three Electron apps stayed under it, at 23 to 27 ms.
- **Holding the press works.** Holding the press and posting it at the target on release delivered one click. A held press that turned into a drag reached the view as an ordinary drag, and a title-bar drag that started beside the close button moved the window 80 pt and left it open.
- **Rewriting the press cannot be used.** It delivered the click, but both drags that started with a rewritten press broke. The view got no events, and the window did not move.
- The tap was created, posted clicks arrived, and a near miss did nothing without heyo.

By the rule this experiment set before it ran, the Mac app does not go ahead as planned. One way around the slow search is untested. With holding, the only safe way to deliver the click, the search could run while the press is held instead of before it, so some or all of it would fall inside the user's own press. That means holding every press on empty space, not only those with a control nearby. The plan treats the Mac app as a maybe until the extension's own log shows that misses are common, so that test waits for the log.

## Run it

1. Open System Settings, Privacy & Security, Accessibility, and turn on the terminal app you will use. Quit and reopen that app.
2. Run:

```bash
cd mac
swift run -c release heyo-feasibility all --out ../dist/mac-feasibility-result
```

It takes about half a minute. For about ten seconds of that it opens a small window, moves the pointer and clicks inside that window. Do not use the mouse during that part. It needs the Command Line Tools and no Xcode.

The command prints each check as it goes, writes `report.md` and `report.json` into the folder, which is git-ignored so a rerun cannot overwrite the committed report, and exits 0 for go and 1 for no-go. If it cannot write the report it says so and exits 4. `heyo-feasibility check` only reports whether the permission is there.

## What it measures

The plan names three reasons to drop the Mac app: processing that adds over 30 ms on top of the press, held presses that break drags, and probing that lags Electron apps. The experiment tests each.

**Accessibility hit tests.** For every running app with a window, it times `AXUIElementCopyElementAtPosition` at 60 random points in the frontmost window, with the plan's 30 ms messaging timeout. It asks each app directly, so a window of another app lying on top cannot answer in its place. At every third point it times the full search the Mac app would do for one press: the hit test at the click point and the 136 on the ring around it. It reports how many hit tests were answered, timed out or failed, the median, the 95th percentile and the slowest answered call, and marks Electron apps. Every ring search is timed, also one whose hit tests timed out, because that time was spent. Separately, an app counts as measured only when at least 80% of its ring searches' hit tests got an answer. An app below that is not a pass, however fast it looks. An app that does not answer when asked where its window is stays in the report as not measured, so it cannot go missing behind an app that answered. Open Safari, Chrome and an Electron app such as Cursor first, so they are measured.

**The event tap.** It opens its own window with one button and a title bar, turns on an active tap, and posts real mouse events:

- A click on the button with the tap off, to show that posted clicks arrive.
- A click 4 pt beside the button with the tap off, which must do nothing.
- The same near miss with the tap rewriting the press's location to the button. The plan marks this unverified. If it works, the app gets a real click with no delay.
- The same near miss with the tap holding the press and posting a press and release at the button when the user lets go. This is the plan's fallback. It delays the click by the length of the user's own press.
- A press at the near-miss point that then moves 60 pt. The held press must be given back where it happened, and the view must see an ordinary drag.
- A press in the title bar 3 pt beside the close button that then moves 80 pt. The window must move 80 pt and stay open. The plan calls this the hard case.
- The same two drags with rewriting. Rewriting moves the press at the moment it happens, before anyone knows whether a drag follows, so a drag that starts at a near miss would start on the target. These two checks say whether that happens.

It also times the tap callback itself.

## Reading the result

- Go: every app was measured and its ring search stays at or under 30 ms at the 95th percentile, the tap callback does too, the tap was created, the two setup checks passed, and one way of delivering the click is safe. A way is safe when it delivers exactly one click and both of its drag checks pass. The report names the way. Anything that did not run or gave no answer makes it no-go.
- Rewriting is safe: build on it. It adds no delay and holds nothing back.
- Rewriting delivers the click but breaks a drag: it cannot be used. The decision is made at the press, and a press that turns out to be a drag has already been moved.
- Only re-posting is safe: the Mac app has to hold presses, and the click arrives when the user lets go.
- The ring search is slow only in Electron apps: ship with those apps excluded, or with fewer sample points for them.
- No way is safe: the plan says to drop Mac retargeting. Shadow mode alone, which never changes or holds a press, would still be possible.

## What is in the package

`mac/` is a Swift package with no dependencies.

- `HeyoKit` holds the parts that need no permission: the ring of sample points, which matches the Chrome extension's, the distance math, and `PressBuffer`, the state machine for holding a press and either clicking the target or giving the press back as a drag. `swift test` covers them, and CI runs it on macOS.
- `heyo-feasibility` is the experiment.

Signing is not set up. The app would ship outside the Mac App Store with a Developer ID certificate, because a sandboxed app cannot use Accessibility.
