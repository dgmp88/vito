import SwiftUI

/// Right pane: the generated markdown document, lightly rendered.
struct DocumentPane: View {
    @Environment(AppState.self) private var state

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PaneHeader(title: "Document", systemImage: "doc.text") {
                Button {
                    copyToPasteboard(state.document)
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .help("Copy markdown")
                .disabled(state.document.isEmpty)
            }

            if state.document.isEmpty {
                emptyState
            } else {
                ScrollView {
                    MarkdownView(markdown: state.document)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .textBackgroundColor))
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "doc")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text("Ask the assistant to write something.")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func copyToPasteboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

/// Minimal block-level markdown renderer: headings, bullets, and paragraphs.
/// Inline formatting (bold/italic/links/code) is handled by AttributedString.
struct MarkdownView: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                block.view
            }
        }
        .textSelection(.enabled)
    }

    private var blocks: [Block] {
        markdown.split(separator: "\n", omittingEmptySubsequences: false)
            .map { Block(line: String($0)) }
    }

    struct Block {
        let line: String

        @ViewBuilder var view: some View {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("### ") {
                Text(inline(String(trimmed.dropFirst(4)))).font(.headline)
            } else if trimmed.hasPrefix("## ") {
                Text(inline(String(trimmed.dropFirst(3)))).font(.title3.weight(.semibold))
            } else if trimmed.hasPrefix("# ") {
                Text(inline(String(trimmed.dropFirst(2)))).font(.title2.weight(.bold))
            } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                HStack(alignment: .top, spacing: 6) {
                    Text("•")
                    Text(inline(String(trimmed.dropFirst(2))))
                }
            } else if trimmed.isEmpty {
                Spacer().frame(height: 2)
            } else {
                Text(inline(line))
            }
        }

        private func inline(_ text: String) -> AttributedString {
            (try? AttributedString(
                markdown: text,
                options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
            )) ?? AttributedString(text)
        }
    }
}
