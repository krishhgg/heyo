import CoreGraphics
import Testing
@testable import HeyoKit

@Suite struct GeometryTests {
    let rect = CGRect(x: 10, y: 20, width: 100, height: 30)

    @Test func distanceIsZeroInsideAndOnTheEdge() {
        #expect(distance(from: CGPoint(x: 50, y: 30), to: rect) == 0)
        #expect(distance(from: CGPoint(x: 10, y: 20), to: rect) == 0)
    }

    @Test func distanceIsMeasuredToTheNearestEdgeOrCorner() {
        #expect(distance(from: CGPoint(x: 4, y: 30), to: rect) == 6)
        #expect(distance(from: CGPoint(x: 50, y: 57), to: rect) == 7)
        #expect(distance(from: CGPoint(x: 7, y: 16), to: rect) == 5)
    }

    @Test func ringsReachThirtyPointsAndMatchTheExtension() {
        let offsets = ringOffsets()
        #expect(offsets.count == 136)
        let farthest = offsets.map { ($0.dx * $0.dx + $0.dy * $0.dy).squareRoot() }.max() ?? 0
        #expect(abs(farthest - 30) < 0.001)
    }
}

@Suite struct StatsTests {
    @Test func percentilesUseTheNearestRank() {
        let samples = (1...100).map(Double.init)
        #expect(percentile(samples, 50) == 50)
        #expect(percentile(samples, 95) == 95)
        #expect(percentile([], 50) == nil)
        #expect(Timing([3, 1, 2])?.max == 3)
    }
}

@Suite struct PressBufferTests {
    let miss = CGPoint(x: 100, y: 100)
    let target = CGPoint(x: 90, y: 100)

    @Test func anOrdinaryPressPassesStraightThrough() {
        var buffer = PressBuffer()
        #expect(buffer.handle(.down(at: miss, target: nil)) == .pass)
        #expect(buffer.handle(.dragged(to: CGPoint(x: 150, y: 100))) == .pass)
        #expect(buffer.handle(.up(at: miss)) == .pass)
    }

    @Test func aNearMissIsHeldAndThenClickedAtTheTarget() {
        var buffer = PressBuffer()
        #expect(buffer.handle(.down(at: miss, target: target)) == .drop)
        #expect(buffer.isHolding)
        #expect(buffer.handle(.up(at: miss)) == .clickAt(target))
        #expect(!buffer.isHolding)
    }

    @Test func aSmallWobbleDuringTheHoldIsStillAClick() {
        var buffer = PressBuffer()
        _ = buffer.handle(.down(at: miss, target: target))
        #expect(buffer.handle(.dragged(to: CGPoint(x: 102, y: 101))) == .drop)
        #expect(buffer.handle(.up(at: CGPoint(x: 102, y: 101))) == .clickAt(target))
    }

    @Test func aRealDragGetsItsPressBackWhereItHappened() {
        var buffer = PressBuffer()
        _ = buffer.handle(.down(at: miss, target: target))
        #expect(buffer.handle(.dragged(to: CGPoint(x: 110, y: 100))) == .releaseHeldPressThenPass(miss))
        // From here on the drag is the user's own.
        #expect(buffer.handle(.dragged(to: CGPoint(x: 140, y: 100))) == .pass)
        #expect(buffer.handle(.up(at: CGPoint(x: 140, y: 100))) == .pass)
    }
}
