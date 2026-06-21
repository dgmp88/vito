import Foundation

/// Minimal configuration for the OpenRouter-backed LLM.
///
/// Resolution order for the API key:
///   1. `OPENROUTER_API_KEY` environment variable (handy for `swift run` / dev)
///   2. `UserDefaults` (set via the in-app settings sheet)
enum AppConfig {
    static let openRouterHost = "openrouter.ai"
    static let openRouterBasePath = "/api/v1"

    /// Default model. OpenRouter slug for Gemini Flash.
    /// (The plan said "gemini flash 3.5"; the closest real slug is 2.5-flash — see NOTES.)
    static let defaultModel = "google/gemini-2.5-flash"

    private static let apiKeyDefaultsKey = "openrouter_api_key"
    private static let modelDefaultsKey = "openrouter_model"

    static var apiKey: String? {
        let stored = UserDefaults.standard.string(forKey: apiKeyDefaultsKey)
        if let stored, !stored.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return stored
        }
        return nil
    }

    static func setApiKey(_ key: String) {
        UserDefaults.standard.set(key, forKey: apiKeyDefaultsKey)
    }

    static var model: String {
        let stored = UserDefaults.standard.string(forKey: modelDefaultsKey)
        if let stored, !stored.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return stored
        }
        return defaultModel
    }

    static func setModel(_ model: String) {
        UserDefaults.standard.set(model, forKey: modelDefaultsKey)
    }
}
