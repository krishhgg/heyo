// The Mac feasibility experiment from docs/plan.md.
//
//   heyo-feasibility check        say whether this process may use Accessibility
//   heyo-feasibility latency      time Accessibility hit tests against the running apps
//   heyo-feasibility tap          try rewriting, re-posting and drags through an event tap
//   heyo-feasibility all          latency, then tap, and write the report
//
// Add `--out <folder>` to choose where report.json and report.md go.
//
// It needs Accessibility permission for the app that runs it, usually the
// terminal. The tap part moves the real pointer and clicks inside its own
// test window for about ten seconds. Do not use the mouse while it runs.
import AppKit
import ApplicationServices
import HeyoKit

let arguments = Array(CommandLine.arguments.dropFirst())
let command = arguments.first ?? "check"
var outDir = FileManager.default.currentDirectoryPath
if let flag = arguments.firstIndex(of: "--out"), arguments.count > flag + 1 {
    outDir = arguments[flag + 1]
}

func say(_ line: String) {
    print(line)
    fflush(stdout)
}

/// True when this process may create an active event tap and query other apps.
func isTrusted() -> Bool {
    AXIsProcessTrusted()
}

func explainMissingPermission() {
    say("""
    This process does not have Accessibility permission, so the experiment cannot run.

    To grant it:
      1. Open System Settings, then Privacy & Security, then Accessibility.
      2. Turn on the app you are running this from (Terminal, Ghostty, iTerm).
         If it is not listed, add it with the + button.
      3. Quit and reopen that app, then run this command again.

    Nothing was measured.
    """)
}

guard ["check", "latency", "tap", "all"].contains(command) else {
    say("usage: heyo-feasibility check | latency | tap | all [--out <folder>]")
    exit(2)
}

say("Accessibility permission: \(isTrusted() ? "yes" : "no")")
if command == "check" {
    if !isTrusted() { explainMissingPermission() }
    exit(isTrusted() ? 0 : 3)
}
guard isTrusted() else {
    explainMissingPermission()
    exit(3)
}

var report = Report()
if command == "latency" || command == "all" {
    report.latency = measureLatency()
}
if command == "tap" || command == "all" {
    report.tap = runTapExperiment()
}
report.write(to: outDir)
say("Wrote report.json and report.md to \(outDir)")
exit(report.verdictIsGo ? 0 : 1)
