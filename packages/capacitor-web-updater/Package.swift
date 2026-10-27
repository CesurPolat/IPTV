// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorWebUpdater",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "CapacitorWebUpdater",
            targets: ["UpdaterPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")
    ],
    targets: [
        .target(
            name: "UpdaterPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/UpdaterPlugin"),
        .testTarget(
            name: "UpdaterPluginTests",
            dependencies: ["UpdaterPlugin"],
            path: "ios/Tests/UpdaterPluginTests")
    ]
)