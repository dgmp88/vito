import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var state
    @State private var showingSettings = false

    var body: some View {
        VStack(spacing: 0) {
            ModelStatusBanner()

            HSplitView {
                TranscriptPane()
                    .frame(minWidth: 280)
                DocumentPane()
                    .frame(minWidth: 320)
            }

            Divider()
            BottomBar(showingSettings: $showingSettings)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
    }
}

/// Shows model download/load progress or a failure, hidden once ready.
private struct ModelStatusBanner: View {
    @Environment(AppState.self) private var state

    var body: some View {
        switch state.modelStatus {
        case .ready:
            EmptyView()
        case .preparing(let message):
            banner(systemImage: "arrow.down.circle", tint: .accentColor) {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(message)
                }
            }
        case .failed(let message):
            banner(systemImage: "exclamationmark.triangle.fill", tint: .red) {
                Text("Speech model failed to load: \(message)")
            }
        }
    }

    @ViewBuilder
    private func banner<Content: View>(systemImage: String, tint: Color, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage).foregroundStyle(tint)
            content()
            Spacer()
        }
        .font(.callout)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
    }
}

#Preview {
    ContentView().environment(AppState())
}
