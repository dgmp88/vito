import SwiftUI

/// Left pane: live speech transcript plus any text replies from the assistant.
struct TranscriptPane: View {
    @Environment(AppState.self) private var state
    private static let thinkingID = "thinking-row"

    private static let liveID = "live-row"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PaneHeader(title: "Transcript", systemImage: "waveform")

            if state.transcript.isEmpty && !state.hasLivePreview {
                emptyState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ForEach(state.transcript) { entry in
                                EntryRow(entry: entry).id(entry.id)
                            }
                            if state.hasLivePreview {
                                LiveRow().id(Self.liveID)
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
                    .onChange(of: state.liveVolatile) {
                        withAnimation { proxy.scrollTo(Self.liveID, anchor: .bottom) }
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

/// Live speech preview shown while recording (and during the final pass): the
/// confirmed text in the normal color, with the still-volatile tail rendered
/// slightly lighter since it may still change.
private struct LiveRow: View {
    @Environment(AppState.self) private var state

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("You")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            (Text(state.liveConfirmed)
                + Text(needsSpace ? " " : "")
                + Text(state.liveVolatile).foregroundStyle(.tertiary))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// A separator between the confirmed text and the volatile tail, only when
    /// both are present.
    private var needsSpace: Bool {
        !state.liveConfirmed.isEmpty && !state.liveVolatile.isEmpty
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

struct PaneHeader<Accessory: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let accessory: () -> Accessory

    init(
        title: String,
        systemImage: String,
        @ViewBuilder accessory: @escaping () -> Accessory = { EmptyView() }
    ) {
        self.title = title
        self.systemImage = systemImage
        self.accessory = accessory
    }

    var body: some View {
        HStack(spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            Spacer()
            accessory()
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
        .overlay(alignment: .bottom) { Divider() }
    }
}
