import AVFoundation
import Foundation
import os

/// Captures microphone audio via an `AVAudioEngine` tap on the input node
/// (plan §1) and writes it to a temporary file. FluidAudio resamples the
/// file to 16 kHz mono on transcription, so we record at the hardware format.
final class AudioRecorder {
    enum RecorderError: LocalizedError {
        case alreadyRecording
        case notRecording

        var errorDescription: String? {
            switch self {
            case .alreadyRecording: return "Already recording."
            case .notRecording: return "Not currently recording."
            }
        }
    }

    private let logger = Logger(subsystem: "com.gerg.vito", category: "AudioRecorder")

    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private var fileURL: URL?
    private var recording = false

    var isRecording: Bool { recording }

    /// Begins capturing. Throws if the engine can't start.
    func start() throws {
        guard !recording else { throw RecorderError.alreadyRecording }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("vito-\(UUID().uuidString).caf")
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        self.file = file
        self.fileURL = url

        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self, let file = self.file else { return }
            do {
                try file.write(from: buffer)
            } catch {
                self.logger.error(
                    "Tap write failed: \(error.localizedDescription, privacy: .public)")
            }
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            self.file = nil
            self.fileURL = nil
            try? FileManager.default.removeItem(at: url)
            throw error
        }
        recording = true
        logger.notice("Recording started → \(url.lastPathComponent, privacy: .public)")
    }

    /// Stops capturing and returns the finalized audio file URL.
    @discardableResult
    func stop() throws -> URL {
        guard recording, let url = fileURL else { throw RecorderError.notRecording }

        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        // Releasing the AVAudioFile flushes and closes it.
        file = nil
        fileURL = nil
        recording = false
        logger.notice("Recording stopped → \(url.lastPathComponent, privacy: .public)")
        return url
    }
}
