import Foundation
import os

/// Sends the full conversation history to an OpenRouter LLM, which either answers
/// in text or calls the `write_document` tool to rewrite the whole document
/// (plan §3). Multi-turn: the model sees its own prior `write_document` tool
/// calls in the history, so edits build on the latest version it wrote.
///
/// Uses a small URLSession client with lenient parsing rather than a typed SDK:
/// OpenRouter + Gemini return tool-call `arguments` as a JSON object (not the
/// stringified JSON the OpenAI spec uses) and sometimes omit/null `finish_reason`,
/// both of which break strict decoders. See NOTES.md.
struct DocumentAgent {
    enum AgentError: LocalizedError, DetailedError {
        case missingAPIKey
        case connectionFailed(String)
        case providerError(message: String, raw: String)
        case unexpectedResponse(summary: String, raw: String)

        var errorDescription: String? {
            switch self {
            case .missingAPIKey:
                return "No OpenRouter API key set. Add one in Settings (⌘,)."
            case .connectionFailed(let message):
                return "Couldn't reach OpenRouter: \(message)"
            case .providerError(let message, _):
                return message
            case .unexpectedResponse(let summary, _):
                return summary
            }
        }

        /// Full detail (raw response body) for the error-detail sheet.
        var detail: String? {
            switch self {
            case .providerError(_, let raw), .unexpectedResponse(_, let raw):
                return raw
            case .missingAPIKey, .connectionFailed:
                return nil
            }
        }
    }

    /// Incremental progress emitted while the model's response streams in, so the
    /// UI can show live text and a running token count instead of a dead spinner.
    struct StreamUpdate: Sendable {
        /// Accumulated assistant text reply so far (empty for a tool-only turn).
        var assistantText: String
        /// Number of streamed completion tokens (exact once usage arrives, an
        /// approximate chunk count before that).
        var tokenCount: Int
        /// True once the model has started emitting a `write_document` tool call.
        var isWritingDocument: Bool
    }

    private let logger = Logger(subsystem: "com.gerg.vito", category: "DocumentAgent")

    static let toolName = "write_document"

    private static let systemPrompt = """
        You are a concise voice assistant. The user talks to you; their speech is \
        transcribed and sent to you as a message. You can either reply with a short \
        text answer, or, when the user wants to create or change a \
        written document, call the `write_document` tool with the COMPLETE new \
        markdown for the document.

        - If the user is asking to write, draft, edit, append to, or restructure a \
        document, call `write_document` with the full updated markdown (not a diff).
        - When editing, start from the most recent version you wrote (your previous \
        `write_document` calls are in the conversation) and return the whole thing \
        with the changes applied.
        - Otherwise, just answer in text.
        """

    /// Sends `history` (everything except the system prompt) and returns the new
    /// message(s) to append: an assistant reply, or an assistant tool call plus
    /// the required `tool`-role response so the next request stays protocol-valid.
    ///
    /// Streams the response (SSE): `onProgress` is called on the main actor as
    /// text and tool-call arguments arrive, so the UI can show live tokens.
    func respond(
        history: [ChatMessage],
        onProgress: @MainActor @Sendable (StreamUpdate) -> Void
    ) async throws -> [ChatMessage] {
        guard let apiKey = AppConfig.apiKey else { throw AgentError.missingAPIKey }

        var messages: [[String: Any]] = [["role": "system", "content": Self.systemPrompt]]
        messages += history.map(\.payload)

        let body: [String: Any] = [
            "model": AppConfig.model,
            "messages": messages,
            "stream": true,
            "stream_options": ["include_usage": true],
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
                                    "description": "The complete markdown content of the document.",
                                ]
                            ],
                            "required": ["markdown"],
                        ],
                    ],
                ]
            ],
        ]

        var request = URLRequest(
            url: URL(
                string:
                    "https://\(AppConfig.openRouterHost)\(AppConfig.openRouterBasePath)/chat/completions"
            )!,
            timeoutInterval: 60
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("Vito", forHTTPHeaderField: "X-Title")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await URLSession.shared.bytes(for: request)
        } catch {
            throw AgentError.connectionFailed(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw AgentError.connectionFailed("Invalid response.")
        }

        // Non-2xx: the body isn't an SSE stream, so drain it for the error detail.
        guard (200...299).contains(http.statusCode) else {
            var errorData = Data()
            for try await byte in bytes { errorData.append(byte) }
            let raw = String(data: errorData, encoding: .utf8) ?? "<non-UTF8 body>"
            throw AgentError.providerError(
                message: Self.extractErrorMessage(from: errorData, status: http.statusCode),
                raw: "HTTP \(http.statusCode)\n\n\(raw)"
            )
        }

        return try await consumeStream(bytes, onProgress: onProgress)
    }

    // MARK: - Streaming (SSE)

    /// Reads the `data:`-prefixed SSE chunks, accumulating the assistant text and
    /// any `write_document` tool-call arguments, then assembles the same message
    /// shape the non-streaming path used to return.
    private func consumeStream(
        _ bytes: URLSession.AsyncBytes,
        onProgress: @MainActor @Sendable (StreamUpdate) -> Void
    ) async throws -> [ChatMessage] {
        var assistantText = ""
        var chunkCount = 0
        var usageTokens: Int?
        // Tool calls accumulate by `index`; arguments arrive as string fragments.
        var toolCalls: [Int: (id: String, name: String, args: String)] = [:]
        var rawLines: [String] = []

        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
            if payload == "[DONE]" { break }
            rawLines.append(payload)

            guard let data = payload.data(using: .utf8),
                let chunk = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { continue }

            if let usage = chunk["usage"] as? [String: Any],
                let completion = usage["completion_tokens"] as? Int
            {
                usageTokens = completion
            }

            guard let choice = (chunk["choices"] as? [[String: Any]])?.first,
                let delta = choice["delta"] as? [String: Any]
            else { continue }

            var emitted = false
            if let content = delta["content"] as? String, !content.isEmpty {
                assistantText += content
                emitted = true
            }
            if let calls = delta["tool_calls"] as? [[String: Any]] {
                for call in calls {
                    let index = (call["index"] as? Int) ?? 0
                    var entry = toolCalls[index] ?? (id: "", name: "", args: "")
                    if let id = call["id"] as? String, !id.isEmpty { entry.id = id }
                    if let function = call["function"] as? [String: Any] {
                        if let name = function["name"] as? String, !name.isEmpty {
                            entry.name = name
                        }
                        if let fragment = function["arguments"] as? String {
                            entry.args += fragment
                        } else if let object = function["arguments"] as? [String: Any],
                            let data = try? JSONSerialization.data(withJSONObject: object),
                            let string = String(data: data, encoding: .utf8)
                        {
                            entry.args = string
                        }
                    }
                    toolCalls[index] = entry
                }
                emitted = true
            }

            if emitted {
                chunkCount += 1
                let update = StreamUpdate(
                    assistantText: assistantText,
                    tokenCount: usageTokens ?? chunkCount,
                    isWritingDocument: !toolCalls.isEmpty
                )
                await onProgress(update)
            }
        }

        let raw = rawLines.joined(separator: "\n")
        let trimmedText = assistantText.trimmingCharacters(in: .whitespacesAndNewlines)

        // Prefer a `write_document` tool call if the model made one.
        if let entry = toolCalls.values.first(where: { $0.name == Self.toolName }) {
            guard let markdown = Self.markdown(fromArguments: entry.args) else {
                throw AgentError.unexpectedResponse(
                    summary: "The write_document tool call had no readable 'markdown' argument.",
                    raw: raw
                )
            }
            let callID = entry.id.isEmpty ? "call_0" : entry.id
            let assistant = ChatMessage(
                role: "assistant",
                content: trimmedText.isEmpty ? nil : trimmedText,
                toolCallsJSON: Self.canonicalToolCallsJSON(callID: callID, markdown: markdown)
            )
            // The protocol requires a tool-role response for each tool_call_id.
            let toolResult = ChatMessage(
                role: "tool", content: "Document updated.", toolCallID: callID)
            return [assistant, toolResult]
        }

        guard !trimmedText.isEmpty else {
            throw AgentError.unexpectedResponse(
                summary: "The response had no tool call and no text content.",
                raw: raw.isEmpty ? "<empty stream>" : raw
            )
        }
        return [ChatMessage(role: "assistant", content: trimmedText)]
    }

    /// Tool-call arguments arrive either as a JSON string (OpenAI spec) or as a
    /// JSON object (Gemini via OpenRouter). Handle both.
    private static func markdown(fromArguments arguments: Any?) -> String? {
        if let dict = arguments as? [String: Any] {
            return dict["markdown"] as? String
        }
        if let string = arguments as? String,
            let data = string.data(using: .utf8),
            let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            return dict["markdown"] as? String
        }
        return nil
    }

    /// Build a spec-compliant `tool_calls` array (arguments as a JSON *string*)
    /// for storage and replay, regardless of how the provider sent it.
    private static func canonicalToolCallsJSON(callID: String, markdown: String) -> String? {
        guard let argsData = try? JSONSerialization.data(withJSONObject: ["markdown": markdown]),
            let argsString = String(data: argsData, encoding: .utf8)
        else { return nil }
        let calls: [[String: Any]] = [
            [
                "id": callID,
                "type": "function",
                "function": ["name": toolName, "arguments": argsString],
            ]
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: calls) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func extractErrorMessage(from data: Data, status: Int) -> String {
        if let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = root["error"] as? [String: Any],
            let message = error["message"] as? String
        {
            return message
        }
        if let text = String(data: data, encoding: .utf8), !text.isEmpty {
            return "HTTP \(status): \(text)"
        }
        return "HTTP \(status)"
    }
}
