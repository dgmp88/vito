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
                .frame(minHeight: 520)
                .task {
                    // Ask for the mic up front, then warm up the speech model.
                    await requestMicrophoneAccess()
                    state.prepareModel()
                }
        }
        .windowStyle(.titleBar)
        // Bound the window's minimum size to the layout's own minimum (sidebar +
        // both detail panes) so it can't be shrunk to a width where the columns
        // overflow and get clipped. Note: don't put `.frame(minWidth:)` on the
        // ContentView/NavigationSplitView — that minimum lands on the *detail*
        // column (the sidebar has its own width), inflating it well past the
        // window and clipping the columns at anything below full screen.
        .windowResizability(.contentMinSize)
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
