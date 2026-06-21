import SwiftUI

/// Minimal settings: OpenRouter API key + model slug.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var apiKey: String = UserDefaults.standard.string(forKey: "openrouter_api_key") ?? ""
    @State private var model: String = AppConfig.model

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Settings").font(.title2.bold())

            VStack(alignment: .leading, spacing: 6) {
                Text("OpenRouter API Key").font(.headline)
                SecureField("sk-or-…", text: $apiKey)
                    .textFieldStyle(.roundedBorder)
                Text("Stored locally in UserDefaults. Get a key at openrouter.ai/keys.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Model").font(.headline)
                TextField(AppConfig.defaultModel, text: $model)
                    .textFieldStyle(.roundedBorder)
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") {
                    AppConfig.setApiKey(apiKey)
                    AppConfig.setModel(model)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 440)
    }
}

#Preview {
    SettingsView()
}
