// Part 1: how long Accessibility hit tests take against real apps.
//
// The Mac app would hit-test the click point and a ring around it before it
// lets a press through. Accessibility queries block on the app being asked,
// and macOS disables an event tap whose callback is slow. The plan allows
// 30 ms on top of the press itself.
import AppKit
import ApplicationServices
import HeyoKit

/// The plan's limit for one query, and for the whole decision.
let budgetMs = 30.0

struct AppLatency: Codable {
    var app: String
    var bundle: String
    var isElectron: Bool
    /// One hit test at one point, in ms. Only answered hit tests are timed.
    var hitTestP50: Double
    var hitTestP95: Double
    var hitTestMax: Double
    /// Hit tests that hit the 30 ms messaging timeout.
    var timeouts: Int
    /// Hit tests that failed for another reason, such as an app that does not support them.
    var errors: Int
    /// Hit tests that got an answer.
    var answered: Int
    /// The whole ring search around one point, 137 hit tests, in ms. Every search
    /// is timed, also one whose hit tests timed out, since that time was spent.
    var ringP50: Double?
    var ringP95: Double?
    /// Share of the ring searches' hit tests that got an answer, from 0 to 1.
    var ringCoverage: Double
}

func milliseconds(_ body: () -> Void) -> Double {
    let start = DispatchTime.now().uptimeNanoseconds
    body()
    return Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
}

/// The frame of an app's frontmost window in screen points, top-left origin, or nil.
func frontWindowFrame(of app: NSRunningApplication) -> CGRect? {
    let element = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 0.5)
    var windows: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &windows) == .success,
          let window = (windows as? [AXUIElement])?.first else { return nil }
    var position: CFTypeRef?
    var size: CFTypeRef?
    guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &position) == .success,
          AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &size) == .success else { return nil }
    var origin = CGPoint.zero
    var extent = CGSize.zero
    // swiftlint:disable:next force_cast
    AXValueGetValue(position as! AXValue, .cgPoint, &origin)
    // swiftlint:disable:next force_cast
    AXValueGetValue(size as! AXValue, .cgSize, &extent)
    return CGRect(origin: origin, size: extent)
}

enum HitResult {
    case answered
    case timedOut
    case failed
}

/// One hit test with the plan's 30 ms timeout, asked of one app, so a window
/// of another app lying on top cannot answer in its place. No element at the
/// point is still an answer.
func hitTest(_ app: AXUIElement, at point: CGPoint) -> (ms: Double, result: HitResult) {
    var element: AXUIElement?
    var error = AXError.success
    let ms = milliseconds {
        error = AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &element)
    }
    switch error {
    case .success, .noValue: return (ms, .answered)
    case .cannotComplete: return (ms, .timedOut)
    default: return (ms, .failed)
    }
}

func measureLatency() -> [AppLatency] {
    let offsets = ringOffsets()
    var results: [AppLatency] = []

    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    for app in apps {
        guard let frame = frontWindowFrame(of: app), frame.width > 100, frame.height > 100 else { continue }
        let element = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(element, Float(budgetMs / 1000))
        let bundlePath = app.bundleURL?.path ?? ""
        let electron = FileManager.default.fileExists(
            atPath: bundlePath + "/Contents/Frameworks/Electron Framework.framework")
        var single: [Double] = []
        var rings: [Double] = []
        var timeouts = 0
        var errors = 0
        var ringTests = 0
        var ringAnswered = 0
        var generator = SystemRandomNumberGenerator()
        for sample in 0..<60 {
            let point = CGPoint(
                x: CGFloat.random(in: frame.minX + 10...frame.maxX - 10, using: &generator),
                y: CGFloat.random(in: frame.minY + 10...frame.maxY - 10, using: &generator))
            let one = hitTest(element, at: point)
            switch one.result {
            case .answered: single.append(one.ms)
            case .timedOut: timeouts += 1
            case .failed: errors += 1
            }
            // The full ring search on every third point.
            guard sample % 3 == 0 else { continue }
            rings.append(milliseconds {
                for offset in offsets {
                    let hit = hitTest(element, at: CGPoint(x: point.x + offset.dx, y: point.y + offset.dy))
                    ringTests += 1
                    if hit.result == .answered { ringAnswered += 1 }
                }
            })
        }
        let name = app.localizedName ?? "unknown"
        let one = Timing(single)
        let ring = Timing(rings)
        let coverage = ringTests > 0 ? Double(ringAnswered) / Double(ringTests) : 0
        say(String(format: "%@: %d of 60 hit tests answered, %d timed out, %d failed. Hit test p95 %@. Ring search p95 %@, with %.0f%% of its hit tests answered.",
                   name, single.count, timeouts, errors,
                   one.map { String(format: "%.2f ms", $0.p95) } ?? "not measured",
                   ring.map { String(format: "%.1f ms", $0.p95) } ?? "not measured", coverage * 100))
        results.append(AppLatency(
            app: name, bundle: app.bundleIdentifier ?? "", isElectron: electron,
            hitTestP50: one?.p50 ?? 0, hitTestP95: one?.p95 ?? 0, hitTestMax: one?.max ?? 0,
            timeouts: timeouts, errors: errors, answered: single.count,
            ringP50: ring?.p50, ringP95: ring?.p95, ringCoverage: coverage))
    }
    if results.isEmpty { say("No app with a window was found to measure.") }
    return results
}
