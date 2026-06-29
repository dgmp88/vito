import Foundation
import Observation
import SwiftData
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
    /// In progress. `fraction` is a 0…1 value when known — byte-accurate across
    /// the download half (0…0.5) and per-component compile half (0.5…1.0) — or
    /// `nil` for steps with no measurable progress (listing, loading), which
    /// render as an indeterminate spinner.
    case preparing(message: String, fraction: Double?)
    case ready
    case failed(String)
}

/// Errors can opt into providing a longer, copyable detail string (e.g. a raw
/// API response) for the error-detail sheet.
protocol DetailedError {
    var detail: String? { get }
}

struct TranscriptEntry: Identifiable, Equatable {
    enum Role: Equatable { case user, assistant }
    let id = UUID()
    let role: Role
    let text: String
}

/// Single source of truth for the UI. Conversations are persisted with SwiftData;
/// the selected conversation's message history drives the transcript and document.
@MainActor
@Observable
final class AppState {
    private let logger = Logger(subsystem: "com.gerg.vito", category: "AppState")

    var phase: Phase = .idle
    var modelStatus: ModelStatus = .preparing(message: "Starting up…", fraction: nil)

    /// The conversation currently shown. `nil` = a fresh, not-yet-created chat
    /// (the "New" state); the first utterance lazily creates and selects one.
    var selectedConversation: Conversation?

    /// Full, copyable detail for the most recent error (e.g. raw API response).
    /// `nil` when the current error has no extra detail.
    var errorDetail: String?

    /// Live streaming state while the assistant responds (phase `.updatingDocument`).
    /// Reset before each turn and cleared once the turn settles.
    var streamedText: String = ""
    var streamedTokens: Int = 0
    var isWritingDocument: Bool = false

    private let modelContext: ModelContext
    private let recorder = AudioRecorder()
    private let transcriber = Transcriber()
    private let agent = DocumentAgent()

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // MARK: - Derived view state

    /// User utterances and text replies for the selected conversation.
    var transcript: [TranscriptEntry] {
        selectedConversation?.transcript ?? []
    }

    /// The current document = the latest `write_document` result in the history.
    var document: String {
        selectedConversation?.document ?? ""
    }

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
                try await transcriber.prepare { [weak self] message, fraction in
                    Task { @MainActor in
                        self?.modelStatus = .preparing(message: message, fraction: fraction)
                    }
                }
                modelStatus = .ready
            } catch {
                logger.error(
                    "Model prepare failed: \(error.localizedDescription, privacy: .public)")
                modelStatus = .failed(error.localizedDescription)
            }
        }
    }

    // MARK: - Conversation management

    /// Start a fresh chat. Defers creation until the first utterance so empty
    /// conversations never get persisted.
    func newConversation() {
        guard !isBusy else { return }
        selectedConversation = nil
        errorDetail = nil
        if case .error = phase { phase = .idle }
    }

    func select(_ conversation: Conversation) {
        guard !isBusy else { return }
        selectedConversation = conversation
        errorDetail = nil
        if case .error = phase { phase = .idle }
    }

    func delete(_ conversation: Conversation) {
        if conversation === selectedConversation {
            selectedConversation = nil
        }
        modelContext.delete(conversation)
        try? modelContext.save()
    }

    // MARK: - Record / Stop

    func toggleRecording() {
        switch phase {
        case .recording:
            stopAndProcess()
        case .idle, .error:
            startRecording()
        default:
            break  // ignore taps while busy
        }
    }

    private func startRecording() {
        guard modelReady else { return }
        errorDetail = nil
        do {
            try recorder.start()
            phase = .recording
        } catch {
            fail("Couldn't start recording", error)
        }
    }

    private func stopAndProcess() {
        let audioURL: URL
        do {
            audioURL = try recorder.stop()
        } catch {
            fail("Recording failed", error)
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
            fail("Transcription failed", error)
            return
        }

        let trimmed = spoken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            // No speech detected — silently return to idle.
            phase = .idle
            return
        }
        let formatted = Self.sentencePerLine(trimmed)

        // Lazily create the conversation on first speech, then record the turn.
        let conversation = ensureConversation()
        if conversation.title.isEmpty {
            conversation.title = Self.makeTitle(from: formatted)
        }
        append(ChatMessage(role: "user", content: formatted), to: conversation)

        // 2. Text → LLM, sending the full history for multi-turn context.
        phase = .updatingDocument
        resetStreamingState()
        do {
            let appended = try await agent.respond(
                history: conversation.orderedMessages.map(\.chatMessage)
            ) { [weak self] update in
                self?.streamedText = update.assistantText
                self?.streamedTokens = update.tokenCount
                self?.isWritingDocument = update.isWritingDocument
            }
            for message in appended {
                append(message, to: conversation)
            }
            conversation.updatedAt = .now
            try? modelContext.save()
            resetStreamingState()
            phase = .idle
        } catch {
            resetStreamingState()
            fail("Assistant failed", error)
            try? modelContext.save()  // keep the user's utterance
        }
    }

    private func resetStreamingState() {
        streamedText = ""
        streamedTokens = 0
        isWritingDocument = false
    }

    // MARK: - Persistence helpers

    private func ensureConversation() -> Conversation {
        if let selectedConversation { return selectedConversation }
        let conversation = Conversation()
        modelContext.insert(conversation)
        selectedConversation = conversation
        return conversation
    }

    private func append(_ message: ChatMessage, to conversation: Conversation) {
        let stored = Message(
            index: conversation.messages.count,
            role: message.role,
            content: message.content,
            toolCallsJSON: message.toolCallsJSON,
            toolCallID: message.toolCallID
        )
        stored.conversation = conversation
        conversation.messages.append(stored)
        modelContext.insert(stored)
    }

    /// Puts each sentence on its own line by following a sentence-ending period
    /// with a newline. Only breaks when the period is followed by whitespace, so
    /// decimals ("3.5") and abbreviations without a trailing space stay intact.
    private static func sentencePerLine(_ text: String) -> String {
        text.replacingOccurrences(
            of: #"\.[ \t]+"#, with: ".\n", options: .regularExpression)
    }

    /// First line of the first utterance, trimmed to a short title.
    private static func makeTitle(from utterance: String) -> String {
        let firstLine =
            utterance.split(whereSeparator: \.isNewline).first.map(String.init) ?? utterance
        let trimmed = firstLine.trimmingCharacters(in: .whitespaces)
        return trimmed.count > 50
            ? String(trimmed.prefix(50)).trimmingCharacters(in: .whitespaces) + "…" : trimmed
    }

    // MARK: - Errors

    /// Sets the error phase with a short message and captures any longer detail
    /// (raw response, full error dump) for the detail sheet.
    private func fail(_ context: String, _ error: Error) {
        phase = .error("\(context): \(error.localizedDescription)")
        if let detailed = error as? DetailedError, let detail = detailed.detail {
            errorDetail = "\(context): \(error.localizedDescription)\n\n\(detail)"
        } else {
            // Fall back to the full error dump so there's always something to inspect.
            errorDetail =
                "\(context): \(error.localizedDescription)\n\n\(String(reflecting: error))"
        }
        logger.error(
            "\(context, privacy: .public): \(error.localizedDescription, privacy: .public)")
    }
}
