# Mac feasibility experiment

## Result

Not run yet. The experiment is built and waits for one permission that only a person at the Mac can give.

It needs macOS Accessibility permission to create an active event tap, to query other apps and to post mouse events. On the build machine no process that an agent can start has that permission. A probe run from the agent's shell printed `AXIsProcessTrusted: false`, could not create an active tap, and got error -25211 (API disabled) from an Accessibility hit test. The computer-use tool is not allowed to drive Terminal, so there was no second route. Granting the permission is a change in System Settings, which was out of bounds for this build.

Until it runs, the Mac app stays at this experiment. The plan's rule holds: do not commit to Mac retargeting before these questions have answers.

## Run it

1. Open System Settings, Privacy & Security, Accessibility, and turn on the terminal app you will use. Quit and reopen that app.
2. Run:

```bash
cd mac
swift run -c release heyo-feasibility all --out ../docs/mac-feasibility-result
```

It takes about half a minute. For about ten seconds of that it opens a small window, moves the pointer and clicks inside that window. Do not use the mouse during that part. It needs the Command Line Tools and no Xcode.

The command prints each check as it goes, writes `report.md` and `report.json` into the folder, and exits 0 for go and 1 for no-go. `heyo-feasibility check` only reports whether the permission is there.

## What it measures

The plan names three reasons to drop the Mac app: processing that adds over 30 ms on top of the press, held presses that break drags, and probing that lags Electron apps. The experiment tests each.

**Accessibility hit tests.** For every running app with a window, it times `AXUIElementCopyElementAtPosition` at 60 random points in the frontmost window, with the plan's 30 ms messaging timeout. At every third point it times the full ring search the Mac app would do, 137 hit tests. It reports the median, the 95th percentile, the slowest call and the number of timeouts for each app, and marks Electron apps. Open Safari, Chrome and an Electron app such as Cursor first, so they are measured.

**The event tap.** It opens its own window with one button and a title bar, turns on an active tap, and posts real mouse events:

- A click on the button with the tap off, to show that posted clicks arrive.
- A click 4 pt beside the button with the tap off, which must do nothing.
- The same near miss with the tap rewriting the press's location to the button. The plan marks this unverified. If it works, the app gets a real click with no delay.
- The same near miss with the tap holding the press and posting a press and release at the button when the user lets go. This is the plan's fallback. It delays the click by the length of the user's own press.
- A press at the near-miss point that then moves 60 pt. The held press must be given back where it happened, and the view must see an ordinary drag.
- A press in the title bar 3 pt beside the close button that then moves 80 pt. The window must move 80 pt and stay open. The plan calls this the hard case.

It also times the tap callback itself.

## Reading the result

- Go: the ring search stays under 30 ms at the 95th percentile in every app, rewriting or re-posting delivers exactly one click, and both drag checks pass. The Mac app's shadow mode is the next step.
- Rewriting works: build on it. There is no delay and nothing to buffer, so the drag cases stop mattering.
- Only re-posting works: the Mac app has to hold presses, and the two drag checks decide whether that is safe.
- The ring search is slow only in Electron apps: ship with those apps excluded, or with fewer sample points for them.
- A drag check fails: the plan says to drop Mac retargeting. Shadow mode alone, which never holds a press, would still be possible.

## What is in the package

`mac/` is a Swift package with no dependencies.

- `HeyoKit` holds the parts that need no permission: the ring of sample points, which matches the Chrome extension's, the distance math, and `PressBuffer`, the state machine for holding a press and either clicking the target or giving the press back as a drag. `swift test` covers them, and CI runs it on macOS.
- `heyo-feasibility` is the experiment.

Signing is not set up. The app would ship outside the Mac App Store with a Developer ID certificate, because a sandboxed app cannot use Accessibility.
