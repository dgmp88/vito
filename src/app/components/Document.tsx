"use client";

import React from "react";
import { useDocumentStore } from "@/stores/documentStore";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface DocumentProps {
  isExpanded: boolean;
}

export const DEFAULT_TEXT = `# No document created yet

Ask the agent to create a document. It will generate Markdown for you **like** *this*`;

function Document({ isExpanded }: DocumentProps) {
  const document = useDocumentStore((state) => state.document);

  return (
    <div className="h-full">
      {isExpanded && (
        <div className="px-6 py-4 h-full overflow-auto">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
            >
              {document || DEFAULT_TEXT}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

export default Document;
