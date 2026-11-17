import CoreGraphics

/// How the Mac app would handle one mouse press, as a pure state machine.
///
/// An event tap cannot let a click land and then look for a reaction, the way
/// the extension does. It has to decide at the press. For a press that looks
/// like a near miss it holds the press back. If the user lets go without
/// moving, it sends the press and the release on at the target. If the user
/// moves first, the press was the start of a drag, so it sends the press on
/// where it really happened and lets the drag through.
public struct PressBuffer {
    /// What the tap should do with the event it was just handed.
    public enum Action: Equatable {
        /// Let the event through unchanged.
        case pass
        /// Swallow the event.
        case drop
        /// Swallow the event and post a press and a release at this point.
        case clickAt(CGPoint)
        /// Post the held press where it happened, then let this event through.
        case releaseHeldPressThenPass(CGPoint)
    }

    /// A mouse event, reduced to what the buffer needs.
    public enum Event: Equatable {
        /// A left press. `target` is where a near miss should go, or nil for an ordinary press.
        case down(at: CGPoint, target: CGPoint?)
        case dragged(to: CGPoint)
        case up(at: CGPoint)
    }

    /// The pointer may move this far during a held press and still count as a click.
    public let slop: CGFloat

    private var held: (at: CGPoint, target: CGPoint)?

    public init(slop: CGFloat = 4) {
        self.slop = slop
    }

    /// True while a press is being held back.
    public var isHolding: Bool { held != nil }

    public mutating func handle(_ event: Event) -> Action {
        switch event {
        case let .down(at, target):
            guard let target else {
                held = nil
                return .pass
            }
            held = (at, target)
            return .drop
        case let .dragged(to):
            guard let press = held else { return .pass }
            let moved = ((to.x - press.at.x) * (to.x - press.at.x) + (to.y - press.at.y) * (to.y - press.at.y)).squareRoot()
            if moved <= slop { return .drop }
            held = nil
            return .releaseHeldPressThenPass(press.at)
        case .up:
            guard let press = held else { return .pass }
            held = nil
            return .clickAt(press.target)
        }
    }
}
