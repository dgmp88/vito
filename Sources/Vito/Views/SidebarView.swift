import SwiftData
import SwiftUI

/// Collapsible sidebar listing stored conversations, newest first, with a New
/// button and per-row delete. Selection is driven through `AppState`.
struct SidebarView: View {
    @Environment(AppState.self) private var state
    @Query(sort: \Conversation.updatedAt, order: .reverse) private var conversations: [Conversation]

    var body: some View {
        List(selection: selectionBinding) {
            ForEach(conversations) { conversation in
                ConversationRow(conversation: conversation)
                    .tag(conversation)
                    .contextMenu {
                        Button(role: .destructive) {
                            state.delete(conversation)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
            }
        }
        .navigationTitle("Chats")
        .overlay {
            if conversations.isEmpty {
                ContentUnavailableView("No chats yet", systemImage: "bubble.left.and.bubble.right",
                                       description: Text("Press Record to start your first conversation."))
            }
        }
        .toolbar {
            ToolbarItem {
                Button {
                    state.newConversation()
                } label: {
                    Label("New Chat", systemImage: "square.and.pencil")
                }
                .help("New chat")
                .disabled(state.isBusy)
            }
        }
    }

    /// Bridges `List` selection (a `Conversation?`) to `AppState`, routing through
    /// `select(_:)` so an in-flight turn isn't interrupted.
    private var selectionBinding: Binding<Conversation?> {
        Binding(
            get: { state.selectedConversation },
            set: { conversation in
                if let conversation {
                    state.select(conversation)
                } else {
                    state.newConversation()
                }
            }
        )
    }
}

private struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(conversation.displayTitle)
                .lineLimit(1)
            Text(conversation.updatedAt, format: .relative(presentation: .named))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
