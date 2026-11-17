// Part 2: what an active event tap can do with a near miss.
//
// The plan leaves three things unverified:
//   - whether a tap can rewrite a press's location so the app gets a real click
//   - whether it can instead hold the press and post it at the target on release
//   - whether a press handled either way can still become a normal drag,
//     including a title-bar drag that starts beside the close button
//
// This opens a small window of its own, turns a tap on, and posts real mouse
// events at it. The window records what it received.
import AppKit
import ApplicationServices
import HeyoKit

struct TapTest: Codable {
    var name: String
    var pass: Bool
    var detail: String
}

struct TapReport: Codable {
    var tests: [TapTest]
    /// Time spent in the tap callback per event, in ms.
    var callbackP95: Double
    var callbackMax: Double
}

/// Marks the events this program posts from inside the tap, so the tap lets them through.
let ownEventMarker: Int64 = 0x6865_796F

enum TapMode {
    case off
    /// Change the press's location and let it through.
    case rewrite
    /// Hold the press and post it at the target on release.
    case repost
}

/// Everything the tap callback reads and writes. It runs on the main thread.
final class TapState {
    var mode = TapMode.off
    /// A press inside this rect, in global coordinates, is a near miss.
    var missZone = CGRect.null
    /// Where a near miss should go, in global coordinates.
    var target = CGPoint.zero
    var buffer = PressBuffer()
    var callbackMs: [Double] = []
}

let tapState = TapState()

/// Posts a mouse event as if it came from the hardware. The driver uses this to act as the user.
func post(_ type: CGEventType, at point: CGPoint) {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
}

/// Posts a mouse event from inside the tap callback. An event posted through
/// the callback's proxy is delivered ahead of the event the callback is about
/// to return, which a post at the hardware entry point does not promise.
func inject(_ type: CGEventType, at point: CGPoint, through proxy: CGEventTapProxy) {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)
    else { return }
    event.setIntegerValueField(.eventSourceUserData, value: ownEventMarker)
    event.tapPostEvent(proxy)
}

func tapCallback(
    proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    if event.getIntegerValueField(.eventSourceUserData) == ownEventMarker || tapState.mode == .off {
        return pass
    }
    var result: Unmanaged<CGEvent>? = pass
    let ms = milliseconds {
        let at = event.location
        let isMiss = tapState.missZone.contains(at)
        switch (tapState.mode, type) {
        case (.rewrite, .leftMouseDown) where isMiss, (.rewrite, .leftMouseUp) where isMiss:
            event.location = tapState.target
        case (.repost, .leftMouseDown):
            if tapState.buffer.handle(.down(at: at, target: isMiss ? tapState.target : nil)) == .drop {
                result = nil
            }
        case (.repost, .leftMouseDragged):
            switch tapState.buffer.handle(.dragged(to: at)) {
            case .drop: result = nil
            case let .releaseHeldPressThenPass(origin): inject(.leftMouseDown, at: origin, through: proxy)
            default: break
            }
        case (.repost, .leftMouseUp):
            if case let .clickAt(target) = tapState.buffer.handle(.up(at: at)) {
                inject(.leftMouseDown, at: target, through: proxy)
                inject(.leftMouseUp, at: target, through: proxy)
                result = nil
            }
        default:
            break
        }
    }
    tapState.callbackMs.append(ms)
    return result
}

/// Records every mouse event the content view gets, in window coordinates.
final class ProbeView: NSView {
    var log: [String] = []

    override func mouseDown(with event: NSEvent) { log.append("down \(Int(event.locationInWindow.x))") }
    override func mouseDragged(with event: NSEvent) { log.append("dragged") }
    override func mouseUp(with event: NSEvent) { log.append("up \(Int(event.locationInWindow.x))") }
}

final class ProbeWindow: NSObject, NSWindowDelegate {
    let window: NSWindow
    let view = ProbeView(frame: NSRect(x: 0, y: 0, width: 420, height: 220))
    let button = NSButton(title: "Alpha", target: nil, action: nil)
    var presses = 0
    var closed = false

    override init() {
        window = NSWindow(
            contentRect: NSRect(x: 240, y: 360, width: 420, height: 220),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        super.init()
        window.title = "heyo feasibility"
        window.level = .floating
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = view
        button.frame = NSRect(x: 40, y: 120, width: 90, height: 32)
        button.target = self
        button.action = #selector(pressed)
        view.addSubview(button)
        window.makeKeyAndOrderFront(nil)
    }

    @objc func pressed() { presses += 1 }
    func windowWillClose(_ notification: Notification) { closed = true }

    /// A rect in the window's coordinates as a rect in global coordinates, whose origin is the top left of the main screen.
    func global(_ rect: NSRect) -> CGRect {
        let onScreen = window.convertToScreen(rect)
        let height = NSScreen.screens.first?.frame.height ?? 0
        return CGRect(x: onScreen.minX, y: height - onScreen.maxY, width: onScreen.width, height: onScreen.height)
    }

    var buttonRect: CGRect { global(button.convert(button.bounds, to: nil)) }

    /// The close button's rect in global coordinates.
    var closeRect: CGRect {
        guard let close = window.standardWindowButton(.closeButton) else { return .null }
        return global(close.convert(close.bounds, to: nil))
    }
}

/// Runs a block on the main thread and waits for it.
func onMain<T>(_ body: () -> T) -> T {
    DispatchQueue.main.sync(execute: body)
}

func pause(_ ms: Int) {
    Thread.sleep(forTimeInterval: Double(ms) / 1000)
}

func runTapExperiment() -> TapReport {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let probe = ProbeWindow()
    app.activate(ignoringOtherApps: true)

    let mask = [CGEventType.leftMouseDown, .leftMouseUp, .leftMouseDragged]
        .reduce(CGEventMask(0)) { $0 | (1 << CGEventMask($1.rawValue)) }
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
        eventsOfInterest: mask, callback: tapCallback, userInfo: nil)
    else {
        say("FAIL \(Verdict.Check.tapCreated.rawValue): tapCreate returned nil")
        probe.window.close()
        return TapReport(
            tests: [TapTest(name: Verdict.Check.tapCreated.rawValue, pass: false, detail: "tapCreate returned nil")],
            callbackP95: 0, callbackMax: 0)
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)

    var tests: [TapTest] = []
    func record(_ check: Verdict.Check, _ pass: Bool, _ detail: String) {
        say("\(pass ? "PASS" : "FAIL") \(check.rawValue): \(detail)")
        tests.append(TapTest(name: check.rawValue, pass: pass, detail: detail))
    }
    record(.tapCreated, true, "an active tap for left mouse events is running")
    func click(at point: CGPoint) {
        post(.mouseMoved, at: point)
        pause(60)
        post(.leftMouseDown, at: point)
        pause(70)
        post(.leftMouseUp, at: point)
        pause(250)
    }
    func drag(from start: CGPoint, by dx: CGFloat) {
        post(.mouseMoved, at: start)
        pause(60)
        post(.leftMouseDown, at: start)
        pause(60)
        for step in 1...8 {
            post(.leftMouseDragged, at: CGPoint(x: start.x + dx * CGFloat(step) / 8, y: start.y))
            pause(25)
        }
        post(.leftMouseUp, at: CGPoint(x: start.x + dx, y: start.y))
        pause(300)
    }
    func reset(_ mode: TapMode, zone: CGRect, target: CGPoint) {
        onMain {
            tapState.mode = mode
            tapState.missZone = zone
            tapState.target = target
            tapState.buffer = PressBuffer()
            probe.presses = 0
            probe.view.log = []
        }
    }

    // The driver posts events from a background thread while the main thread runs the app.
    DispatchQueue.global().async {
        pause(600)
        let button = onMain { probe.buttonRect }
        let middle = CGPoint(x: button.midX, y: button.midY)
        // 4 points right of the button, level with its middle.
        let miss = CGPoint(x: button.maxX + 4, y: button.midY)
        let zone = CGRect(x: button.maxX, y: button.minY, width: 12, height: button.height)

        reset(.off, zone: .null, target: .zero)
        click(at: middle)
        record(.clicksArrive, onMain { probe.presses } == 1,
               "a click on the button with the tap off pressed it \(onMain { probe.presses }) time(s)")

        click(at: miss)
        record(.missDoesNothing, onMain { probe.presses } == 1,
               "a click 4 pt beside the button pressed it \(onMain { probe.presses } - 1) more time(s)")

        reset(.rewrite, zone: zone, target: middle)
        click(at: miss)
        let cursor = CGEvent(source: nil)?.location ?? .zero
        record(.rewrite,
               onMain { probe.presses } == 1,
               "pressed \(onMain { probe.presses }) time(s). The pointer ended at x \(Int(cursor.x)), and the miss was at x \(Int(miss.x)).")

        reset(.repost, zone: zone, target: middle)
        click(at: miss)
        record(.repost,
               onMain { probe.presses } == 1, "pressed \(onMain { probe.presses }) time(s)")

        // A press that turns into a drag. The decision was made at the press, so
        // each way has to give the drag back where the user pressed.
        func dragFromTheMiss(_ mode: TapMode, _ check: Verdict.Check) {
            // The title-bar check moves the window, so the button is found again each time.
            let button = onMain { probe.buttonRect }
            let miss = CGPoint(x: button.maxX + 4, y: button.midY)
            let zone = CGRect(x: button.maxX, y: button.minY, width: 12, height: button.height)
            reset(mode, zone: zone, target: CGPoint(x: button.midX, y: button.midY))
            drag(from: miss, by: 60)
            let log = onMain { probe.view.log }
            let dragged = log.first?.hasPrefix("down") == true && log.contains("dragged") && log.last?.hasPrefix("up") == true
            record(check,
                   dragged && onMain { probe.presses } == 0,
                   "the view got: \(log.isEmpty ? "nothing" : log.prefix(3).joined(separator: ", ") + " ... " + (log.last ?? "")). The button was pressed \(onMain { probe.presses }) time(s).")
        }

        // The hard case: a title-bar drag that starts just beside the close button.
        func dragTheTitleBar(_ mode: TapMode, _ check: Verdict.Check) {
            guard !onMain({ probe.closed }) else {
                record(check, false, "the window was closed by an earlier check")
                return
            }
            let close = onMain { probe.closeRect }
            let beside = CGPoint(x: close.maxX + 3, y: close.midY)
            let closeZone = CGRect(x: close.maxX, y: close.minY, width: 8, height: close.height)
            let before = onMain { probe.window.frame.origin.x }
            reset(mode, zone: closeZone, target: CGPoint(x: close.midX, y: close.midY))
            drag(from: beside, by: 80)
            let moved = onMain { probe.window.frame.origin.x } - before
            record(check,
                   abs(moved - 80) < 6 && !onMain { probe.closed },
                   "the window moved \(Int(moved)) pt of 80 and is \(onMain { probe.closed } ? "closed" : "still open")")
        }

        dragFromTheMiss(.repost, .heldDrag)
        dragTheTitleBar(.repost, .titleBarDrag)
        // Rewriting moves the press before anyone knows a drag follows, so the
        // same two drags are tried with it. They come last, in case one closes the window.
        dragFromTheMiss(.rewrite, .rewriteDrag)
        dragTheTitleBar(.rewrite, .rewriteTitleBarDrag)

        onMain {
            tapState.mode = .off
            CGEvent.tapEnable(tap: tap, enable: false)
            probe.window.close()
            app.stop(nil)
            // stop takes effect at the next event.
            app.postEvent(NSEvent.otherEvent(
                with: .applicationDefined, location: .zero, modifierFlags: [], timestamp: 0,
                windowNumber: 0, context: nil, subtype: 0, data1: 0, data2: 0)!, atStart: true)
        }
    }
    app.run()

    let timing = Timing(tapState.callbackMs)
    return TapReport(tests: tests, callbackP95: timing?.p95 ?? 0, callbackMax: timing?.max ?? 0)
}
