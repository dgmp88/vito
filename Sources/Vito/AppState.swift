import Foundation
import Observation
import os

/// High-level app phases shown to the user (plan §4 User Feedback).
enum Phase: Equatable {
    case idle
    case recording
    case transcribing
    case updatingDocument
    case error(String)
}

/// Readiness of the on-device Parakeet model (downloaded + loaded on first run).
enum ModelStatus: Equatable {
    case preparing(String)   // human-readable progress message
    case ready
    case failed(String)
}

struct TranscriptEntry: Identifiable, Equatable {
    enum Role: Equatable { case user, assistant }
    let id = UUID()
    let role: Role
    let text: String
}

/// Single source of truth for the UI. In-memory only (plan §State).
@MainActor
@Observable
final class AppState {
    private let logger = Logger(subsystem: "com.faultline.vito", category: "AppState")

    var phase: Phase = .idle
    var modelStatus: ModelStatus = .preparing("Starting up…")
    var transcript: [TranscriptEntry] = []
    var document: String = ""

    private let recorder = AudioRecorder()
    private let transcriber = Transcriber()
    private let agent = DocumentAgent()

    var isRecording: Bool { phase == .recording }

    var isBusy: Bool {
        switch phase {
        case .transcribing, .updatingDocument: return true
        default: return false
        }
    }

    var modelReady: Bool { modelStatus == .ready }

    // MARK: - Lifecycle

    /// Kick off the (potentially long) Parakeet download + load in the background.
    func prepareModel() {
        Task {
            do {
                try await transcriber.prepare { [weak self] message in
                    Task { @MainActor in self?.modelStatus = .preparing(message) }
                }
                modelStatus = .ready
            } catch {
                logger.error("Model prepare failed: \(error.localizedDescription, privacy: .public)")
                modelStatus = .failed(error.localizedDescription)
            }
        }
    }

    // MARK: - Record / Stop

    func toggleRecording() {
        switch phase {
        case .recording:
            stopAndProcess()
        case .idle, .error:
            startRecording()
        default:
            break // ignore taps while busy
        }
    }

    private func startRecording() {
        guard modelReady else { return }
        do {
            try recorder.start()
            phase = .recording
        } catch {
            phase = .error("Couldn't start recording: \(error.localizedDescription)")
        }
    }

    private func stopAndProcess() {
        let audioURL: URL
        do {
            audioURL = try recorder.stop()
        } catch {
            phase = .error("Recording failed: \(error.localizedDescription)")
            return
        }

        Task {
            await transcribeThenUpdate(audioURL: audioURL)
        }
    }

    private func transcribeThenUpdate(audioURL: URL) async {
        defer { try? FileManager.default.removeItem(at: audioURL) }

        // 1. Speech → text
        phase = .transcribing
        let spoken: String
        do {
            spoken = try await transcriber.transcribe(fileURL: audioURL)
        } catch {
            phase = .error("Transcription failed: \(error.localizedDescription)")
            return
        }

        let trimmed = spoken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            // No speech detected — silently return to idle.
            phase = .idle
            return
        }
        transcript.append(TranscriptEntry(role: .user, text: trimmed))

        // 2. Text → LLM (may answer in text or rewrite the document)
        phase = .updatingDocument
        do {
            let outcome = try await agent.respond(utterance: trimmed, currentDocument: document)
            switch outcome {
            case .document(let markdown):
                document = markdown
            case .text(let reply):
                transcript.append(TranscriptEntry(role: .assistant, text: reply))
            }
            phase = .idle
        } catch {
            phase = .error("Assistant failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Clear

    func clear() {
        transcript.removeAll()
        document = ""
        if case .error = phase { phase = .idle }
    }
}
