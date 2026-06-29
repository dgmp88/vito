import AVFoundation
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

    /// The loaded model bundle, retained so the live streaming recognizer can
    /// reuse it instead of triggering a second download/load.
    private var models: AsrModels?

    /// Active live-preview recognizer, when recording. Distinct from `manager`:
    /// it shares the same model weights but keeps cache-aware sliding-window
    /// state. The authoritative transcript still comes from `transcribe(fileURL:)`.
    private var stream: SlidingWindowAsrManager?

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
        self.models = models
        logger.notice("Parakeet ready")
    }

    // MARK: - Live streaming (preview)

    /// Window settings for the live preview. The recognizer only emits an update
    /// once it has `chunkSeconds + rightContextSeconds` of audio buffered and
    /// then advances one chunk at a time — FluidAudio's `.streaming` preset
    /// (11s + 2s) means no text appears until 13s in, and its `hypothesisChunk`
    /// "quick feedback" field is unused. We use a small window so the first words
    /// show in ~2.5s and refresh roughly every 2s. Lower per-window context than
    /// the offline pass, but this is only a preview — `transcribe(fileURL:)`
    /// produces the committed transcript.
    private static let livePreviewConfig = SlidingWindowAsrConfig(
        chunkSeconds: 2.0,
        hypothesisChunkSeconds: 1.0,
        leftContextSeconds: 4.0,
        rightContextSeconds: 0.5,
        minContextForConfirmation: 3.0,
        confirmationThreshold: 0.80
    )

    /// Begins a live, sliding-window transcription session reusing the loaded
    /// model, and returns the stream of partial updates. Each update carries
    /// `isConfirmed` (stable text) vs. volatile (may still change) so the UI can
    /// render the unstable tail differently. This is a best-effort preview; the
    /// committed transcript is produced by `transcribe(fileURL:)` after Stop.
    func beginStreaming() async throws -> AsyncStream<SlidingWindowTranscriptionUpdate> {
        guard let models else { throw TranscriberError.notReady }
        let stream = SlidingWindowAsrManager(config: Self.livePreviewConfig)
        // Access `transcriptionUpdates` first so the continuation is registered
        // before any audio is fed in — otherwise early updates are dropped.
        let updates = await stream.transcriptionUpdates
        try await stream.start(models: models, source: .microphone)
        self.stream = stream
        return updates
    }

    /// Feeds one captured buffer to the live recognizer. No-op if not streaming.
    func streamAudio(_ buffer: AVAudioPCMBuffer) async {
        await stream?.streamAudio(buffer)
    }

    /// Tears down the live recognizer without waiting for a final result.
    func cancelStreaming() async {
        await stream?.cancel()
        stream = nil
    }

    /// Transcribes a recorded audio file. FluidAudio handles resampling to 16 kHz mono.
    func transcribe(fileURL: URL) async throws -> String {
        guard let manager else { throw TranscriberError.notReady }
        let result = try await manager.transcribe(fileURL, source: .microphone)
        return result.text
    }
}
