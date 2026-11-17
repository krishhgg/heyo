// The experiment's result, as JSON for tools and Markdown for people.
import Foundation
import HeyoKit

struct Report: Codable {
    var latency: [AppLatency]?
    var tap: TapReport?

    /// The go or no-go, by the plan's stop conditions. A part that did not run is never a pass.
    var verdict: Verdict {
        let passed = tap.map { report in
            Set(report.tests.filter(\.pass).compactMap { Verdict.Check(rawValue: $0.name) })
        }
        let ran = Set((tap?.tests ?? []).compactMap { Verdict.Check(rawValue: $0.name) })
        return Verdict(
            apps: latency?.map {
                Verdict.App(name: $0.app, isElectron: $0.isElectron, ringP95: $0.ringP95, coverage: $0.ringCoverage)
            },
            passed: passed, ran: ran, callbackP95: tap?.callbackP95 ?? 0, budgetMs: budgetMs)
    }

    var problems: [String] { verdict.problems }
    var verdictIsGo: Bool { verdict.isGo }

    var markdown: String {
        var lines = ["# Mac feasibility result", ""]
        if latency == nil || tap == nil {
            lines.append("Only part of the experiment ran, so there is no verdict. Run `heyo-feasibility all`.")
            lines.append(contentsOf: problems.map { "- \($0)" })
        } else if problems.isEmpty {
            lines.append("Go. Every check stayed inside the plan's limits.")
        } else {
            lines.append("No-go as built. The plan's stop conditions were hit:")
            lines.append(contentsOf: problems.map { "- \($0)" })
        }
        if let latency {
            lines += ["", "## Accessibility hit tests", "",
                      "| App | Electron | Answered | Timed out | Failed | Hit test p50 | p95 | max | Ring search p95 | Ring answered |",
                      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
            for app in latency {
                lines.append(String(
                    format: "| %@ | %@ | %d | %d | %d | %.2f ms | %.2f ms | %.1f ms | %@ | %.0f%% |",
                    app.app, app.isElectron ? "yes" : "no", app.answered, app.timeouts, app.errors,
                    app.hitTestP50, app.hitTestP95, app.hitTestMax,
                    app.ringP95.map { String(format: "%.1f ms", $0) } ?? "not measured", app.ringCoverage * 100))
            }
        }
        if let tap {
            lines += ["", "## Event tap", ""]
            lines.append(contentsOf: tap.tests.map { "- \($0.pass ? "Pass" : "Fail"): \($0.name). \($0.detail)" })
            lines.append(String(format: "- Tap callback time: p95 %.2f ms, max %.2f ms.", tap.callbackP95, tap.callbackMax))
        }
        return lines.joined(separator: "\n") + "\n"
    }

    func write(to folder: String) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? encoder.encode(self).write(to: URL(fileURLWithPath: folder + "/report.json"))
        try? markdown.write(toFile: folder + "/report.md", atomically: true, encoding: .utf8)
    }
}
