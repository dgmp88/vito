import Foundation
import os

/// Sends the latest utterance + current document to an OpenRouter LLM, which
/// either answers in text or calls the `write_document` tool to rewrite the
/// whole document (plan §3). v1 replaces the entire document each time.
///
/// Uses a small URLSession client with lenient parsing rather than a typed SDK:
/// OpenRouter + Gemini return tool-call `arguments` as a JSON object (not the
/// stringified JSON the OpenAI spec uses) and sometimes omit/null `finish_reason`,
/// both of which break strict decoders. See NOTES.md.
struct DocumentAgent {
    enum Outcome {
        case text(String)        // assistant chose to reply in text
        case document(String)    // assistant rewrote the document (markdown)
    }

    enum AgentError: LocalizedError {
        case missingAPIKey
        case connectionFailed(String)
        case providerError(String)
        case emptyResponse

        var errorDescription: String? {
            switch self {
            case .missingAPIKey:
                return "No OpenRouter API key set. Add one in Settings (⌘,)."
            case .connectionFailed(let message):
                return "Couldn't reach OpenRouter: \(message)"
            case .providerError(let message):
                return message
            case .emptyResponse:
                return "The model returned an empty response."
            }
        }
    }

    private let logger = Logger(subsystem: "com.faultline.vito", category: "DocumentAgent")

    private static let toolName = "write_document"

    private static let systemPrompt = """
    You are a concise voice assistant. The user talks to you; their speech is \
    transcribed and sent to you as a message. You can either reply with a short \
    spoken-style text answer, or, when the user wants to create or change a \
    written document, call the `write_document` tool with the COMPLETE new \
    markdown for the document.

    Rules:
    - If the user is asking to write, draft, edit, append to, or restructure a \
    document, call `write_document` with the full updated markdown (not a diff).
    - When editing, start from the current document (provided below) and return \
    the whole thing with your changes applied.
    - Otherwise, just answer in text. Keep text answers brief.
    """

    func respond(utterance: String, currentDocument: String) async throws -> Outcome {
        guard let apiKey = AppConfig.apiKey else { throw AgentError.missingAPIKey }

        let documentContext = currentDocument.isEmpty
            ? "The document is currently empty."
            : "Current document:\n\n\(currentDocument)"

        let body: [String: Any] = [
            "model": AppConfig.model,
            "messages": [
                ["role": "system", "content": Self.systemPrompt],
                ["role": "user", "content": "\(documentContext)\n\nUser said: \(utterance)"]
            ],
            "tools": [
                [
                    "type": "function",
                    "function": [
                        "name": Self.toolName,
                        "description": "Create or replace the document with new markdown content.",
                        "parameters": [
                            "type": "object",
                            "properties": [
                                "markdown": [
                                    "type": "string",
                                    "description": "The complete markdown content of the document."
                                ]
                            ],
                            "required": ["markdown"]
                        ]
                    ]
                ]
            ]
        ]

        var request = URLRequest(
            url: URL(string: "https://\(AppConfig.openRouterHost)\(AppConfig.openRouterBasePath)/chat/completions")!,
            timeoutInterval: 60
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("Vito", forHTTPHeaderField: "X-Title")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw AgentError.connectionFailed(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw AgentError.connectionFailed("Invalid response.")
        }
        guard (200...299).contains(http.statusCode) else {
            throw AgentError.providerError(Self.extractErrorMessage(from: data, status: http.statusCode))
        }

        return try parse(data)
    }

    // MARK: - Lenient parsing

    private func parse(_ data: Data) throws -> Outcome {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = root["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any] else {
            throw AgentError.emptyResponse
        }

        // Prefer a tool call if present.
        if let toolCalls = message["tool_calls"] as? [[String: Any]] {
            for call in toolCalls {
                guard let function = call["function"] as? [String: Any],
                      (function["name"] as? String) == Self.toolName else { continue }
                if let markdown = Self.markdown(fromArguments: function["arguments"]) {
                    return .document(markdown)
                }
            }
        }

        let text = (message["content"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !text.isEmpty else { throw AgentError.emptyResponse }
        return .text(text)
    }

    /// Tool-call arguments arrive either as a JSON string (OpenAI spec) or as a
    /// JSON object (Gemini via OpenRouter). Handle both.
    private static func markdown(fromArguments arguments: Any?) -> String? {
        if let dict = arguments as? [String: Any] {
            return dict["markdown"] as? String
        }
        if let string = arguments as? String,
           let data = string.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return dict["markdown"] as? String
        }
        return nil
    }

    private static func extractErrorMessage(from data: Data, status: Int) -> String {
        if let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = root["error"] as? [String: Any],
           let message = error["message"] as? String {
            return message
        }
        if let text = String(data: data, encoding: .utf8), !text.isEmpty {
            return "HTTP \(status): \(text)"
        }
        return "HTTP \(status)"
    }
}
