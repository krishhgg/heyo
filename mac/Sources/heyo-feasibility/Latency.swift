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
    /// One hit test at one point, in ms.
    var hitTestP50: Double
    var hitTestP95: Double
    var hitTestMax: Double
    /// Hit tests that hit the 30 ms messaging timeout.
    var timeouts: Int
    var samples: Int
    /// The whole ring search around one point, 137 hit tests, in ms.
    var ringP50: Double
    var ringP95: Double
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

/// One hit test with the plan's 30 ms timeout. Returns the time taken and whether it timed out.
func hitTest(_ system: AXUIElement, at point: CGPoint) -> (ms: Double, timedOut: Bool) {
    var element: AXUIElement?
    var result = AXError.success
    let ms = milliseconds {
        result = AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &element)
    }
    return (ms, result == .cannotComplete)
}

func measureLatency() -> [AppLatency] {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, Float(budgetMs / 1000))
    let offsets = ringOffsets()
    var results: [AppLatency] = []

    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    for app in apps {
        guard let frame = frontWindowFrame(of: app), frame.width > 100, frame.height > 100 else { continue }
        let bundlePath = app.bundleURL?.path ?? ""
        let electron = FileManager.default.fileExists(
            atPath: bundlePath + "/Contents/Frameworks/Electron Framework.framework")
        var single: [Double] = []
        var rings: [Double] = []
        var timeouts = 0
        var generator = SystemRandomNumberGenerator()
        for sample in 0..<60 {
            let point = CGPoint(
                x: CGFloat.random(in: frame.minX + 10...frame.maxX - 10, using: &generator),
                y: CGFloat.random(in: frame.minY + 10...frame.maxY - 10, using: &generator))
            let one = hitTest(system, at: point)
            single.append(one.ms)
            if one.timedOut { timeouts += 1 }
            // The full ring search on every third point.
            guard sample % 3 == 0 else { continue }
            rings.append(milliseconds {
                for offset in offsets {
                    _ = hitTest(system, at: CGPoint(x: point.x + offset.dx, y: point.y + offset.dy))
                }
            })
        }
        guard let one = Timing(single), let ring = Timing(rings) else { continue }
        let name = app.localizedName ?? "unknown"
        say(String(format: "%@: hit test p50 %.2f ms, p95 %.2f ms, max %.1f ms, %d timeouts. Ring search p95 %.1f ms.",
                   name, one.p50, one.p95, one.max, timeouts, ring.p95))
        results.append(AppLatency(
            app: name, bundle: app.bundleIdentifier ?? "", isElectron: electron,
            hitTestP50: one.p50, hitTestP95: one.p95, hitTestMax: one.max, timeouts: timeouts,
            samples: one.count, ringP50: ring.p50, ringP95: ring.p95))
    }
    if results.isEmpty { say("No app with a window was found to measure.") }
    return results
}
