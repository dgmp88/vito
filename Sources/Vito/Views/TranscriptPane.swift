import SwiftUI

/// Left pane: live speech transcript plus any text replies from the assistant.
struct TranscriptPane: View {
    @Environment(AppState.self) private var state
    private static let thinkingID = "thinking-row"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PaneHeader(title: "Transcript", systemImage: "waveform")

            if state.transcript.isEmpty {
                emptyState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ForEach(state.transcript) { entry in
                                EntryRow(entry: entry).id(entry.id)
                            }
                            if state.phase == .updatingDocument {
                                ThinkingRow().id(Self.thinkingID)
                            }
                        }
                        .padding(16)
                    }
                    .onChange(of: state.transcript.count) {
                        if let last = state.transcript.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                    .onChange(of: state.streamedText) {
                        withAnimation { proxy.scrollTo(Self.thinkingID, anchor: .bottom) }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "mic")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text("Press Record and start speaking.")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct EntryRow: View {
    let entry: TranscriptEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(entry.role == .user ? "You" : "Assistant")
                .font(.caption.weight(.semibold))
                .foregroundStyle(entry.role == .user ? .secondary : Color.accentColor)
            Text(entry.text)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Live placeholder shown while the assistant is responding: a spinner, a running
/// token count, and the text streaming in (or a note when it's writing the doc).
private struct ThinkingRow: View {
    @Environment(AppState.self) private var state

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("Assistant")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                ProgressView().controlSize(.small)
                if state.streamedTokens > 0 {
                    Text("\(state.streamedTokens) tokens")
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(.tertiary)
                }
            }

            if !state.streamedText.isEmpty {
                Text(state.streamedText)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if state.isWritingDocument {
                Text("📝 Writing the document…")
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PaneHeader: View {
    let title: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Divider() }
    }
}
