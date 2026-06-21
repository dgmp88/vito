import SwiftUI

/// Bottom bar: record/stop button, status text, clear, and settings (plan §Product Shape).
struct BottomBar: View {
    @Environment(AppState.self) private var state
    @Binding var showingSettings: Bool
    @State private var showingErrorDetail = false

    var body: some View {
        HStack(spacing: 14) {
            recordButton

            statusText
                .foregroundStyle(.secondary)
                .font(.callout)
                .lineLimit(1)
                .truncationMode(.tail)

            if state.errorDetail != nil {
                Button("Details") { showingErrorDetail = true }
                    .buttonStyle(.link)
                    .font(.callout)
            }

            Spacer()

            Button(role: .destructive) {
                if let conversation = state.selectedConversation {
                    state.delete(conversation)
                }
            } label: {
                Label("Delete", systemImage: "trash")
            }
            .help("Delete this chat")
            .disabled(state.selectedConversation == nil)

            Button {
                showingSettings = true
            } label: {
                Image(systemName: "gearshape")
            }
            .help("Settings")
            .keyboardShortcut(",", modifiers: .command)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.bar)
        .sheet(isPresented: $showingErrorDetail) {
            ErrorDetailView(detail: state.errorDetail ?? "No detail available.")
        }
    }

    private var recordButton: some View {
        Button {
            state.toggleRecording()
        } label: {
            Label(state.isRecording ? "Stop" : "Record",
                  systemImage: state.isRecording ? "stop.circle.fill" : "record.circle")
                .frame(minWidth: 90)
        }
        .controlSize(.large)
        .buttonStyle(.borderedProminent)
        .tint(state.isRecording ? .red : .accentColor)
        .disabled(!state.modelReady || state.isBusy)
    }

    @ViewBuilder
    private var statusText: some View {
        switch state.phase {
        case .idle:
            Text(state.modelReady ? "Ready" : "Loading…")
        case .recording:
            Text("Recording…")
        case .transcribing:
            Text("Transcribing…")
        case .updatingDocument:
            let verb = state.isWritingDocument ? "Writing" : "Thinking"
            if state.streamedTokens > 0 {
                Text("\(verb)… \(state.streamedTokens) tokens")
                    .monospacedDigit()
            } else {
                Text("\(verb)…")
            }
        case .error(let message):
            Text(message).foregroundStyle(.red)
        }
    }
}
