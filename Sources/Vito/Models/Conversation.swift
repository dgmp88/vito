import Foundation
import SwiftData

/// A stored chat. Persisted via SwiftData; the `messages` relationship holds the
/// full conversation in the OpenAI chat-completions shape, so the list *is* the
/// resumable request payload (load = decode, resume = re-send).
@Model
final class Conversation {
    /// Empty until the first user utterance sets a title from it.
    var title: String = ""
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    @Relationship(deleteRule: .cascade, inverse: \Message.conversation)
    var messages: [Message] = []

    init(title: String = "", createdAt: Date = .now, updatedAt: Date = .now) {
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Messages in send/display order.
    var orderedMessages: [Message] {
        messages.sorted { $0.index < $1.index }
    }

    var displayTitle: String {
        title.isEmpty ? "New Chat" : title
    }

    /// The current document = the markdown from the most recent `write_document`
    /// tool call in the history. Empty if the assistant has only replied in text.
    var document: String {
        for message in orderedMessages.reversed() {
            if let markdown = message.writtenDocumentMarkdown {
                return markdown
            }
        }
        return ""
    }

    /// User utterances and text replies, for the transcript pane. Tool-call-only
    /// assistant turns become a short "updated the document" note.
    var transcript: [TranscriptEntry] {
        orderedMessages.compactMap { $0.transcriptEntry }
    }

    var isEmpty: Bool { messages.isEmpty }
}

/// One chat message, mirroring an OpenAI chat-completions message. `toolCallsJSON`
/// stores the `tool_calls` array verbatim (arguments normalized to spec-string),
/// so it round-trips straight back into a request.
@Model
final class Message {
    /// Position in the conversation; SwiftData relationships are unordered.
    var index: Int = 0
    var role: String = "user"               // system | user | assistant | tool
    var content: String?
    var toolCallsJSON: String?              // JSON array string, OpenAI shape
    var toolCallID: String?                 // set on tool-result messages
    var conversation: Conversation?

    init(
        index: Int,
        role: String,
        content: String? = nil,
        toolCallsJSON: String? = nil,
        toolCallID: String? = nil
    ) {
        self.index = index
        self.role = role
        self.content = content
        self.toolCallsJSON = toolCallsJSON
        self.toolCallID = toolCallID
    }

    var chatMessage: ChatMessage {
        ChatMessage(role: role, content: content, toolCallsJSON: toolCallsJSON, toolCallID: toolCallID)
    }

    /// If this is an assistant `write_document` tool call, the markdown it wrote.
    var writtenDocumentMarkdown: String? {
        guard role == "assistant", let toolCallsJSON else { return nil }
        return ChatMessage.documentMarkdown(fromToolCallsJSON: toolCallsJSON)
    }

    var transcriptEntry: TranscriptEntry? {
        switch role {
        case "user":
            return content.map { TranscriptEntry(role: .user, text: $0) }
        case "assistant":
            if let content, !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return TranscriptEntry(role: .assistant, text: content)
            }
            if writtenDocumentMarkdown != nil {
                return TranscriptEntry(role: .assistant, text: "📝 Updated the document.")
            }
            return nil
        default:
            return nil // system / tool messages aren't shown
        }
    }
}

/// Plain value type carrying a message to/from `DocumentAgent`, decoupling the
/// agent from SwiftData. `payload` is the dictionary sent in the request body.
struct ChatMessage: Equatable {
    var role: String
    var content: String?
    var toolCallsJSON: String?
    var toolCallID: String?

    /// Wire representation for the `messages` array of a chat request.
    var payload: [String: Any] {
        var dict: [String: Any] = ["role": role]
        if let content { dict["content"] = content }
        if let toolCallsJSON,
           let data = toolCallsJSON.data(using: .utf8),
           let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            dict["tool_calls"] = array
        }
        if let toolCallID { dict["tool_call_id"] = toolCallID }
        return dict
    }

    /// Extract the `markdown` argument from a stored `tool_calls` JSON array.
    static func documentMarkdown(fromToolCallsJSON json: String) -> String? {
        guard let data = json.data(using: .utf8),
              let calls = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return nil
        }
        for call in calls {
            guard let function = call["function"] as? [String: Any],
                  (function["name"] as? String) == DocumentAgent.toolName,
                  let argsString = function["arguments"] as? String,
                  let argsData = argsString.data(using: .utf8),
                  let args = try? JSONSerialization.jsonObject(with: argsData) as? [String: Any] else {
                continue
            }
            return args["markdown"] as? String
        }
        return nil
    }
}
