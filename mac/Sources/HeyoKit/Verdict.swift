/// The experiment's go or no-go, worked out from plain numbers so it can be tested.
///
/// The plan drops the Mac app if processing adds over 30 ms on top of the press,
/// if held presses break drags, or if probing lags Electron apps. A check that
/// did not run, or ran and gave no answer, is never a pass.
public struct Verdict: Equatable {
    /// What one app's Accessibility timing came to.
    public struct App: Equatable {
        public let name: String
        public let isElectron: Bool
        /// Ring search time at the 95th percentile, in ms. Nil when too few queries got an answer.
        public let ringP95: Double?

        public init(name: String, isElectron: Bool, ringP95: Double?) {
            self.name = name
            self.isElectron = isElectron
            self.ringP95 = ringP95
        }
    }

    /// Names of the tap checks, shared by the experiment and the verdict.
    public enum Check: String, CaseIterable {
        case tapCreated = "the active event tap was created"
        case clicksArrive = "posted clicks reach the window"
        case missDoesNothing = "a near miss does nothing without heyo"
        case rewrite = "rewriting the press's location"
        case repost = "holding the press and posting it at the target on release"
        case heldDrag = "a held press that becomes a drag"
        case titleBarDrag = "a title-bar drag that starts beside the close button"
    }

    public let problems: [String]
    public var isGo: Bool { problems.isEmpty }

    /// - Parameters:
    ///   - apps: the latency result per app, or nil if the latency part did not run.
    ///   - passed: the tap checks that passed, or nil if the tap part did not run.
    ///   - ran: the tap checks that ran at all.
    ///   - callbackP95: time in the tap callback at the 95th percentile, in ms.
    ///   - budgetMs: the plan's limit.
    public init(apps: [App]?, passed: Set<Check>?, ran: Set<Check> = [], callbackP95: Double = 0, budgetMs: Double = 30) {
        var found: [String] = []

        if let apps {
            let measured = apps.filter { $0.ringP95 != nil }
            if measured.isEmpty { found.append("No app's Accessibility hit tests could be measured.") }
            for app in apps {
                guard let p95 = app.ringP95 else {
                    found.append("\(app.name) did not answer enough hit tests to be measured.")
                    continue
                }
                if p95 > budgetMs {
                    let kind = app.isElectron ? ", an Electron app," : ""
                    found.append("The ring search in \(app.name)\(kind) took \(Int(p95.rounded())) ms at the 95th percentile, over the \(Int(budgetMs)) ms limit.")
                }
            }
        } else {
            found.append("The Accessibility timing did not run.")
        }

        if let passed {
            // Without these three the other checks mean nothing.
            for check in [Check.tapCreated, .clicksArrive, .missDoesNothing] where !passed.contains(check) {
                found.append("The setup check failed or did not run: \(check.rawValue).")
            }
            if !passed.contains(.rewrite) && !passed.contains(.repost) {
                found.append("Neither rewriting nor re-posting a press delivered exactly one click.")
            }
            // Rewriting holds nothing back, so drags only matter when re-posting is the way that works.
            if !passed.contains(.rewrite) {
                for check in [Check.heldDrag, .titleBarDrag] where !passed.contains(check) {
                    found.append("\(ran.contains(check) ? "Failed" : "Did not run"): \(check.rawValue).")
                }
            }
            if callbackP95 > budgetMs {
                found.append("The tap callback took \(Int(callbackP95.rounded())) ms at the 95th percentile.")
            }
        } else {
            found.append("The event tap checks did not run.")
        }
        problems = found
    }
}
