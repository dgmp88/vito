"use client";

import React, { useState } from "react";
import Events from "./Events";
import Document from "./Document";

export interface TabbedPanelProps {
  isExpanded: boolean;
}

function TabbedPanel({ isExpanded }: TabbedPanelProps) {
  const [activeTab, setActiveTab] = useState<"logs" | "document">("document");

  return (
    <div
      className={
        (isExpanded ? "w-1/2 overflow-auto" : "w-0 overflow-hidden opacity-0") +
        " transition-all rounded-xl duration-200 ease-in-out flex-col bg-white"
      }
    >
      {isExpanded && (
        <div>
          <div className="flex items-center justify-between px-6 py-3.5 sticky top-0 z-10 text-base border-b bg-white rounded-t-xl">
            <div className="flex space-x-4">
              <button
                onClick={() => setActiveTab("logs")}
                className={`font-semibold ${
                  activeTab === "logs" ? "text-blue-600" : "text-gray-500"
                }`}
              >
                Logs
              </button>
              <button
                onClick={() => setActiveTab("document")}
                className={`font-semibold ${
                  activeTab === "document" ? "text-blue-600" : "text-gray-500"
                }`}
              >
                Document
              </button>
            </div>
          </div>
          
          <div className="h-full overflow-auto">
            {activeTab === "logs" && <Events isExpanded={true} />}
            {activeTab === "document" && <Document isExpanded={true} />}
          </div>
        </div>
      )}
    </div>
  );
}

export default TabbedPanel;