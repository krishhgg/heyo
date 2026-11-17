/// The value at a percentile of a list of samples, by the nearest-rank method. Nil for an empty list.
public func percentile(_ samples: [Double], _ p: Double) -> Double? {
    guard !samples.isEmpty else { return nil }
    let sorted = samples.sorted()
    let rank = Int((p / 100 * Double(sorted.count)).rounded(.up))
    return sorted[min(max(rank, 1), sorted.count) - 1]
}

/// A short summary of timing samples in milliseconds.
public struct Timing: Equatable {
    public let count: Int
    public let p50: Double
    public let p95: Double
    public let max: Double

    public init?(_ samples: [Double]) {
        guard let p50 = percentile(samples, 50), let p95 = percentile(samples, 95), let max = samples.max() else {
            return nil
        }
        self.count = samples.count
        self.p50 = p50
        self.p95 = p95
        self.max = max
    }
}
