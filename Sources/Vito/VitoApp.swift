import AVFoundation
import SwiftUI

@main
struct VitoApp: App {
    @State private var state = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(state)
                .frame(minWidth: 820, minHeight: 520)
                .task {
                    // Ask for the mic up front, then warm up the speech model.
                    await requestMicrophoneAccess()
                    state.prepareModel()
                }
        }
        .windowStyle(.titleBar)
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
