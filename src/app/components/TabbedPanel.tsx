"use client";

import React, { useState } from "react";
import Events from "./Events";
import Document, { DEFAULT_TEXT } from "./Document";
import { ClipboardCopyIcon } from "@radix-ui/react-icons";
import { useDocumentStore } from "@/stores/documentStore";

export interface TabbedPanelProps {
  isExpanded: boolean;
  className?: string;
}

function TabbedPanel({ isExpanded, className = "" }: TabbedPanelProps) {
  const [activeTab, setActiveTab] = useState<"logs" | "document">("document");
  const documentText = useDocumentStore((state) => state.document);
  const [justCopied, setJustCopied] = useState(false);

  const handleCopyDocument = async () => {
    try {
      await navigator.clipboard.writeText(documentText || DEFAULT_TEXT);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy document:", error);
    }
  };

  return (
    <div
      className={
        (isExpanded
          ? "w-full md:w-1/2 overflow-auto"
          : "w-0 overflow-hidden opacity-0") +
        " transition-all rounded-xl duration-200 ease-in-out flex-col bg-white " +
        className
      }
    >
      {isExpanded && (
        <div>
          <div className="flex items-center justify-between px-6 py-3.5 sticky top-0 z-10 text-base border-b bg-white rounded-t-xl">
            <div className="flex space-x-4">
              <button
                onClick={() => setActiveTab("document")}
                className={`font-semibold ${
                  activeTab === "document" ? "text-blue-600" : "text-gray-500"
                }`}
              >
                Document
              </button>
              <button
                onClick={() => setActiveTab("logs")}
                className={`font-semibold ${
                  activeTab === "logs" ? "text-blue-600" : "text-gray-500"
                }`}
              >
                Logs
              </button>
            </div>
            {activeTab === "document" && (
              <button
                onClick={handleCopyDocument}
                className="w-24 text-sm px-3 py-1 rounded-md bg-gray-200 hover:bg-gray-300 flex items-center justify-center gap-x-1"
              >
                <ClipboardCopyIcon />
                {justCopied ? "Copied!" : "Copy"}
              </button>
            )}
          </div>

          <div className="h-full overflow-auto">
            {activeTab === "document" && <Document isExpanded={true} />}
            {activeTab === "logs" && <Events isExpanded={true} />}
          </div>
        </div>
      )}
    </div>
  );
}

export default TabbedPanel;
