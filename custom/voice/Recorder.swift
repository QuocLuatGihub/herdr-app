import Foundation
import AVFoundation

// One recording per process. A job-specific stop file avoids signalling unrelated apps.
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
struct SpeechGate {
    var lastVoice: Double? = nil
    mutating func stop(power: Float, elapsed: Double) -> Bool {
        if power > -42 { lastVoice = elapsed }
        if let last = lastVoice { return elapsed - last >= 2.0 }
        return elapsed >= 10.0
    }
}
let args = CommandLine.arguments
if args.count == 2 && args[1] == "--self-test" {
    var gate = SpeechGate()
    precondition(!gate.stop(power: -80, elapsed: 1))
    precondition(!gate.stop(power: -20, elapsed: 2))
    precondition(!gate.stop(power: -80, elapsed: 3))
    precondition(gate.stop(power: -80, elapsed: 4.1))
    var silent = SpeechGate()
    precondition(silent.stop(power: -80, elapsed: 10))
    print("Silence detection tests passed")
    exit(0)
}
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
    let directory = url.deletingLastPathComponent()
    var index = 0
    let active = directory.appendingPathComponent("recording.wav")
    func begin() throws -> AVAudioRecorder {
        let recorder = try AVAudioRecorder(url: active, settings: settings)
        recorder.isMeteringEnabled = true
        guard recorder.prepareToRecord(), recorder.record() else { fail("Could not start microphone recording.") }
        return recorder
    }
    var recorder = try begin()
    try Data("ready".utf8).write(to: URL(fileURLWithPath: ready), options: .atomic)
    let started = Date()
    var segmentStarted = Date()
    var gate = SpeechGate()
    while Date().timeIntervalSince(started) < 60 && !FileManager.default.fileExists(atPath: stop) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        recorder.updateMeters()
        if gate.stop(power: recorder.averagePower(forChannel: 0), elapsed: Date().timeIntervalSince(started)) { break }
        if Date().timeIntervalSince(segmentStarted) >= 3 {
            recorder.stop()
            let chunk = directory.appendingPathComponent(String(format: "chunk-%03d.wav", index))
            try FileManager.default.moveItem(at: active, to: chunk)
            index += 1
            recorder = try begin()
            segmentStarted = Date()
        }
    }
    recorder.stop()
    let chunk = directory.appendingPathComponent(String(format: "chunk-%03d.wav", index))
    try FileManager.default.moveItem(at: active, to: chunk)
    print(directory.path)
} catch { fail(error.localizedDescription) }
