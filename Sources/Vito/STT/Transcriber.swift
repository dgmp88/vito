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

    private let logger = Logger(subsystem: "com.gerg.vito", category: "Transcriber")
    private var manager: AsrManager?

    /// Downloads (if needed) and loads the model into memory.
    /// `onProgress` reports a status message plus a 0…1 fraction when one is
    /// known (`nil` ⇒ indeterminate). FluidAudio's `fractionCompleted` is
    /// byte-accurate and maps the download to 0…0.5 and the compile to 0.5…1.0,
    /// so it drives one continuous bar across both phases.
    func prepare(onProgress: @escaping @Sendable (String, Double?) -> Void) async throws {
        if manager != nil { return }

        onProgress("Preparing speech model…", nil)
        let progressHandler: DownloadUtils.ProgressHandler = { progress in
            switch progress.phase {
            case .listing:
                // Fetching the file manifest — no byte count yet, stay indeterminate.
                onProgress("Preparing speech model download…", nil)
            case .downloading:
                // Byte-accurate; spans 0…0.5. The single ~425 MB encoder is most
                // of this, so the bar moves smoothly even while the file count sits.
                onProgress("Downloading speech model…", progress.fractionCompleted)
            case .compiling(let modelName):
                // Spans 0.5…1.0, one step per model component.
                let name = modelName.isEmpty ? "speech model" : modelName
                onProgress("Compiling \(name)…", progress.fractionCompleted)
            }
        }

        let models = try await AsrModels.downloadAndLoad(
            version: .v3, progressHandler: progressHandler)
        onProgress("Loading model into memory…", nil)
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
