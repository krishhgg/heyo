import CoreGraphics

/// Distance in points from a point to the nearest edge of a rect, or 0 if the point is inside it.
public func distance(from point: CGPoint, to rect: CGRect) -> CGFloat {
    let dx = max(rect.minX - point.x, 0, point.x - rect.maxX)
    let dy = max(rect.minY - point.y, 0, point.y - rect.maxY)
    return (dx * dx + dy * dy).squareRoot()
}

/// The sample points on rings around a click, nearest ring first. The radii and
/// the spacing match the Chrome extension's, so both look the same distance out.
public func ringOffsets(radii: [CGFloat] = [3, 6, 9, 12, 16, 20, 25, 30], spacing: CGFloat = 6) -> [CGVector] {
    radii.flatMap { radius -> [CGVector] in
        let count = max(8, Int((2 * .pi * radius / spacing).rounded(.up)))
        return (0..<count).map { i in
            let angle = 2 * CGFloat.pi * CGFloat(i) / CGFloat(count)
            return CGVector(dx: radius * cos(angle), dy: radius * sin(angle))
        }
    }
}
