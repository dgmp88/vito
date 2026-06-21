import FluidAudio
import Foundation
import os

/// Thin wrapper around FluidAudio's Parakeet TDT 0.6B-v3 (plan §2).
///
/// On first run FluidAudio downloads a ~6 GB CoreML bundle; `prepare` surfaces
/// progress so the UI can show a loading state.
actor Transcriber {
    enum TranscriberError: LocalizedError {
        case notReady

        var errorDescription: String? {
            switch self {
            case .notReady: return "Speech model is not ready yet."
            }
        }
    }

    private let logger = Logger(subsystem: "com.faultline.vito", category: "Transcriber")
    private var manager: AsrManager?

    /// Downloads (if needed) and loads the model into memory.
    /// `onProgress` is called with coarse human-readable status strings.
    func prepare(onProgress: @escaping @Sendable (String) -> Void) async throws {
        if manager != nil { return }

        onProgress("Preparing speech model…")
        let progressHandler: DownloadUtils.ProgressHandler = { progress in
            switch progress.phase {
            case .listing:
                onProgress("Preparing speech model download…")
            case .downloading(let completed, let total):
                guard total > 0 else { return }
                let percent = max(0, min(100, Int(progress.fractionCompleted * 100)))
                onProgress("Downloading speech model… \(percent)% (\(completed)/\(total))")
            case .compiling:
                onProgress("Compiling speech model…")
            }
        }

        let models = try await AsrModels.downloadAndLoad(version: .v3, progressHandler: progressHandler)
        onProgress("Loading model into memory…")
        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        self.manager = manager
        logger.notice("Parakeet ready")
    }

    /// Transcribes a recorded audio file. FluidAudio handles resampling to 16 kHz mono.
    func transcribe(fileURL: URL) async throws -> String {
        guard let manager else { throw TranscriberError.notReady }
        let result = try await manager.transcribe(fileURL, source: .microphone)
        return result.text
    }
}
