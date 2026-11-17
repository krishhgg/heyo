// The experiment's result, as JSON for tools and Markdown for people.
import Foundation

struct Report: Codable {
    var latency: [AppLatency]?
    var tap: TapReport?

    /// The plan drops the Mac app if processing adds over 30 ms, if held presses
    /// break drags, or if probing lags Electron apps.
    var problems: [String] {
        var found: [String] = []
        for app in latency ?? [] where app.ringP95 > budgetMs {
            found.append("The ring search in \(app.app) took \(String(format: "%.0f", app.ringP95)) ms at the 95th percentile, over the 30 ms limit\(app.isElectron ? ". It is an Electron app" : "").")
        }
        if let tap {
            let failed = Set(tap.tests.filter { !$0.pass }.map(\.name))
            let rewrite = "rewriting the press's location"
            let repost = "holding the press and posting it at the target on release"
            if failed.contains(rewrite) && failed.contains(repost) {
                found.append("Neither rewriting nor re-posting a press delivered the click.")
            }
            for name in ["a held press that becomes a drag", "a title-bar drag that starts beside the close button"]
            where failed.contains(name) {
                found.append("Failed: \(name).")
            }
            if tap.callbackP95 > budgetMs {
                found.append("The tap callback took \(String(format: "%.1f", tap.callbackP95)) ms at the 95th percentile.")
            }
        }
        return found
    }

    var verdictIsGo: Bool { latency != nil && tap != nil && problems.isEmpty }

    var markdown: String {
        var lines = ["# Mac feasibility result", ""]
        if latency == nil || tap == nil {
            lines.append("Only part of the experiment ran. Run `heyo-feasibility all` for a verdict.")
        } else if problems.isEmpty {
            lines.append("Go. Every check stayed inside the plan's limits.")
        } else {
            lines.append("No-go as built. The plan's stop conditions were hit:")
            lines.append(contentsOf: problems.map { "- \($0)" })
        }
        if let latency {
            lines += ["", "## Accessibility hit tests", "",
                      "| App | Electron | Hit test p50 | p95 | max | Timeouts | Ring search p95 |",
                      "| --- | --- | --- | --- | --- | --- | --- |"]
            for app in latency {
                lines.append(String(
                    format: "| %@ | %@ | %.2f ms | %.2f ms | %.1f ms | %d of %d | %.1f ms |",
                    app.app, app.isElectron ? "yes" : "no", app.hitTestP50, app.hitTestP95, app.hitTestMax,
                    app.timeouts, app.samples, app.ringP95))
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
