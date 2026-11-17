// swift-tools-version:6.0
import Foundation
import PackageDescription

// With only the Command Line Tools installed, and no Xcode, the compiler does
// not find Swift Testing's macro plugin or framework by itself. Point it there.
let tools = "/Library/Developer/CommandLineTools"
let macros = "\(tools)/usr/lib/swift/host/plugins/testing"
let frameworks = "\(tools)/Library/Developer/Frameworks"
let needsHelp = FileManager.default.fileExists(atPath: macros)
    && !FileManager.default.fileExists(atPath: "/Applications/Xcode.app")
let testSwiftSettings: [SwiftSetting] = needsHelp
    ? [.unsafeFlags(["-plugin-path", macros, "-F", frameworks])]
    : []
let testLinkerSettings: [LinkerSetting] = needsHelp
    ? [.unsafeFlags(["-F", frameworks, "-Xlinker", "-rpath", "-Xlinker", frameworks])]
    : []

let package = Package(
    name: "heyo-mac",
    platforms: [.macOS(.v13)],
    targets: [
        // Logic with no system calls, so it can be tested without any permission.
        .target(name: "HeyoKit"),
        // The feasibility experiment from docs/plan.md. It needs Accessibility permission to run.
        .executableTarget(name: "heyo-feasibility", dependencies: ["HeyoKit"]),
        .testTarget(
            name: "HeyoKitTests",
            dependencies: ["HeyoKit"],
            swiftSettings: testSwiftSettings,
            linkerSettings: testLinkerSettings
        ),
    ],
    swiftLanguageModes: [.v5]
)
