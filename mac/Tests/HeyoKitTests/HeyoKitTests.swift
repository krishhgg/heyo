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

@Suite struct VerdictTests {
    let fast = [Verdict.App(name: "Safari", isElectron: false, ringP95: 12, coverage: 1)]
    let all = Set(Verdict.Check.allCases)

    @Test func everythingInsideTheLimitsIsGo() {
        #expect(Verdict(apps: fast, passed: all, ran: all, callbackP95: 2).isGo)
    }

    @Test func aPartThatDidNotRunIsNeverGo() {
        #expect(!Verdict(apps: nil, passed: all, ran: all).isGo)
        #expect(!Verdict(apps: fast, passed: nil).isGo)
    }

    @Test func noMeasuredAppIsNotGo() {
        #expect(!Verdict(apps: [], passed: all, ran: all).isGo)
        let silent = [Verdict.App(name: "Cursor", isElectron: true, ringP95: nil, coverage: 0)]
        #expect(!Verdict(apps: silent, passed: all, ran: all).isGo)
    }

    @Test func aSlowRingSearchIsNotGo() {
        let slow = fast + [Verdict.App(name: "Cursor", isElectron: true, ringP95: 48, coverage: 1)]
        let verdict = Verdict(apps: slow, passed: all, ran: all)
        #expect(!verdict.isGo)
        #expect(verdict.problems.first?.contains("Electron") == true)
    }

    @Test func anAppThatMostlyDidNotAnswerIsNotGoHoweverFastItLooks() {
        // One quick answer among many failures must not pass for a fast app.
        let patchy = [Verdict.App(name: "Cursor", isElectron: true, ringP95: 4, coverage: 0.05)]
        #expect(!Verdict(apps: patchy, passed: all, ran: all).isGo)
        let enough = [Verdict.App(name: "Cursor", isElectron: true, ringP95: 4, coverage: 0.8)]
        #expect(Verdict(apps: enough, passed: all, ran: all).isGo)
    }

    @Test func timeSpentOnSearchesThatTimedOutStillCounts() {
        // Every hit test timed out at 30 ms, so the ring took seconds. That is slow, not unmeasured-and-fine.
        let stalled = [Verdict.App(name: "Cursor", isElectron: true, ringP95: 4110, coverage: 0)]
        let verdict = Verdict(apps: stalled, passed: all, ran: all)
        #expect(verdict.problems.count == 2)
    }

    @Test func aTapThatWasNotCreatedIsNotGo() {
        #expect(!Verdict(apps: fast, passed: [], ran: [.tapCreated]).isGo)
    }

    @Test func aFailedSetupCheckIsNotGo() {
        #expect(!Verdict(apps: fast, passed: all.subtracting([.clicksArrive]), ran: all).isGo)
        #expect(!Verdict(apps: fast, passed: all.subtracting([.missDoesNothing]), ran: all).isGo)
    }

    @Test func oneSafeWayToDeliverTheClickIsEnough() {
        let rewriting: Set<Verdict.Check> = [.rewrite, .rewriteDrag, .rewriteTitleBarDrag]
        let reposting: Set<Verdict.Check> = [.repost, .heldDrag, .titleBarDrag]
        #expect(Verdict(apps: fast, passed: all.subtracting(reposting), ran: all).way == .rewrite)
        #expect(Verdict(apps: fast, passed: all.subtracting(rewriting), ran: all).way == .repost)
        #expect(!Verdict(apps: fast, passed: all.subtracting([.rewrite, .repost]), ran: all).isGo)
        // Rewriting adds no delay, so it is the way to build on when both are safe.
        #expect(Verdict(apps: fast, passed: all, ran: all).way == .rewrite)
    }

    @Test func aWayThatBreaksDragsIsNotSafe() {
        // A rewritten press starts a drag on the target, not where the user pressed.
        // Delivering the click is not enough to build on rewriting.
        let clicksOnly = all.subtracting([.rewriteDrag, .rewriteTitleBarDrag, .repost])
        let verdict = Verdict(apps: fast, passed: clicksOnly, ran: all)
        #expect(!verdict.isGo)
        #expect(verdict.way == nil)
        #expect(verdict.problems.count == 2)
        // Re-posting with a broken title-bar drag is no better.
        #expect(!Verdict(apps: fast, passed: all.subtracting([.rewrite, .titleBarDrag]), ran: all).isGo)
        #expect(!Verdict(apps: fast, passed: all.subtracting([.rewrite, .heldDrag]), ran: all).isGo)
    }

    @Test func aBrokenWayDoesNotBlockWhenTheOtherIsSafe() {
        // Rewriting breaks drags, as expected. Re-posting passes everything.
        let verdict = Verdict(apps: fast, passed: all.subtracting([.rewriteDrag, .rewriteTitleBarDrag]), ran: all)
        #expect(verdict.isGo)
        #expect(verdict.way == .repost)
    }

    @Test func aSlowCallbackIsNotGo() {
        #expect(!Verdict(apps: fast, passed: all, ran: all, callbackP95: 31).isGo)
    }
}
