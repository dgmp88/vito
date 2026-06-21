import SwiftUI

/// Bottom bar: record/stop button, status text, clear, and settings (plan §Product Shape).
struct BottomBar: View {
    @Environment(AppState.self) private var state
    @Binding var showingSettings: Bool

    var body: some View {
        HStack(spacing: 14) {
            recordButton

            statusText
                .foregroundStyle(.secondary)
                .font(.callout)

            Spacer()

            Button(role: .destructive) {
                state.clear()
            } label: {
                Label("Clear", systemImage: "trash")
            }
            .disabled(state.transcript.isEmpty && state.document.isEmpty)

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
            Text("Thinking…")
        case .error(let message):
            Text(message).foregroundStyle(.red)
        }
    }
}
