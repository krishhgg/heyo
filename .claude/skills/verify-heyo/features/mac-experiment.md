# Mac feasibility experiment

`mac/` is a Swift package with the experiment the plan asks for before any Mac retargeting: can an event tap deliver a near miss to its target, do drags survive, and are Accessibility hit tests fast enough. It needs Accessibility permission to run.

## Sub-features

- `check` says whether the process has Accessibility permission, and how to grant it.
- `latency` times Accessibility hit tests and the ring search against every running app with a window.
- `tap` tries rewriting a press, re-posting it at the target, and turning a held press back into a drag.
- `report` writes `report.md` and `report.json` and exits 0 for go, 1 for no-go.
- `logic` is the permission-free part: the ring of sample points, the press buffer and the go or no-go verdict.

## How to get to it (user POV)

- Grant Accessibility permission to the terminal app in System Settings, then reopen it.
- Run `swift run -c release heyo-feasibility all --out <folder>` in `mac/`.

## Driving it with verify.mjs

Preconditions:

- The Swift toolchain is installed (`swift --version`). `verify.mjs` is not used. This feature has no browser part.

- **Logic.** Run `swift test` in `mac/`. It ends with `Test run with 17 tests in 4 suites passed`.
- **Permission check.** Run `swift run -c release heyo-feasibility check` in `mac/`. It prints `Accessibility permission: yes` or `no`. With `no` it prints the steps to grant it and `Nothing was measured.`
- **The experiment.** With the permission, run `swift run -c release heyo-feasibility all --out /tmp/heyo-mac`. Each tap check prints a `PASS` or `FAIL` line, and each app prints its hit-test times. `report.md` in the folder holds the verdict.
- **Proof.** Keep `report.md` and `report.json`. Without the permission the proof is the output of `check`, and the experiment is unverified.

## Gotchas

- An agent's shell usually has no Accessibility permission. `check` printing `no` is the expected result there, and it is not a failure of the build.
- The tap part moves the real pointer and clicks for about ten seconds. Nobody else may be using the machine's pointer.
- With only the Command Line Tools and no Xcode, Swift Testing needs extra search paths. `Package.swift` adds them when it sees that setup.
- Permission is per host app. After granting it, quit and reopen the terminal.
