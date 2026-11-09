import Foundation
import AVFoundation

// One recording per process. A job-specific stop file avoids signalling unrelated apps.
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
let args = CommandLine.arguments
if args.count == 2 && args[1] == "--check" {
    print("Herdr Voice recorder ready")
    exit(0)
}
guard args.count == 4 else { fail("Usage: herdr-recorder <wav> <stop-file> <ready-file>") }
let url = URL(fileURLWithPath: args[1])
let stop = args[2]
let ready = args[3]
var permission: Bool? = nil
AVCaptureDevice.requestAccess(for: .audio) { granted in
    DispatchQueue.main.async { permission = granted }
}
let permissionDeadline = Date().addingTimeInterval(90)
while permission == nil && Date() < permissionDeadline && !FileManager.default.fileExists(atPath: stop) {
    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
}
guard permission == true else { fail("Microphone access is required. Enable Herdr Custom or Herdr Core in System Settings > Privacy & Security > Microphone, then retry.") }
let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM,
    AVSampleRateKey: 16000.0,
    AVNumberOfChannelsKey: 1,
    AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false,
    AVLinearPCMIsBigEndianKey: false
]
do {
    let recorder = try AVAudioRecorder(url: url, settings: settings)
    guard recorder.prepareToRecord(), recorder.record() else { fail("Could not start microphone recording.") }
    try Data("ready".utf8).write(to: URL(fileURLWithPath: ready), options: .atomic)
    let deadline = Date().addingTimeInterval(60)
    while Date() < deadline && !FileManager.default.fileExists(atPath: stop) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    recorder.stop()
    guard let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber, size.intValue > 44 else { fail("No audio was recorded.") }
    print(url.path)
} catch { fail(error.localizedDescription) }
