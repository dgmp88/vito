import AVFoundation
import SwiftData
import SwiftUI

@main
struct VitoApp: App {
    private let container: ModelContainer
    @State private var state: AppState

    init() {
        // One on-disk SwiftData store under Application Support, shared between
        // AppState (which mutates conversations) and the sidebar's @Query.
        let container: ModelContainer
        do {
            container = try ModelContainer(for: Conversation.self)
        } catch {
            fatalError("Failed to create the SwiftData container: \(error)")
        }
        self.container = container
        _state = State(initialValue: AppState(modelContext: container.mainContext))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(state)
                .frame(minWidth: 960, minHeight: 520)
                .task {
                    // Ask for the mic up front, then warm up the speech model.
                    await requestMicrophoneAccess()
                    state.prepareModel()
                }
        }
        .windowStyle(.titleBar)
        .modelContainer(container)
        .commands {
            // ⌘, opens settings via the standard menu item (handled in ContentView).
        }
    }

    private func requestMicrophoneAccess() async {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        guard status == .notDetermined else { return }
        await AVCaptureDevice.requestAccess(for: .audio)
    }
}
