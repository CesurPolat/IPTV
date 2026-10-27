import Foundation

@objc public class Updater: NSObject {
    @objc public func echo(_ value: String) -> String {
        print(value)
        return value
    }
}
