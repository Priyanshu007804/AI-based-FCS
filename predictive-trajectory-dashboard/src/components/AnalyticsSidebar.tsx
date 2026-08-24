"use client";

import { TerminalSquare, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

export type FCSLogEntry = {
  id: string;
  ts: string;
  text: string;
  type?: "info" | "warning" | "fire" | "success";
};

type AnalyticsSidebarProps = {
  logs: FCSLogEntry[];
};

export function AnalyticsSidebar({ logs }: AnalyticsSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={`border-t border-[#1c2a3a] bg-[#0c131c] transition-all duration-200 shrink-0 ${
        collapsed ? "h-9" : "h-36"
      } flex flex-col`}
    >
      <div
        className="flex items-center justify-between border-b border-[#1c2a3a]/80 px-4 py-1.5 cursor-pointer bg-[#0a1018] select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-medium text-slate-200">
            FCS Tactical Telemetry & System Event Stream
          </span>
          <span className="font-mono text-[10px] text-cyan-400/70 bg-cyan-950/40 px-1.5 py-0.2 rounded border border-cyan-800/30">
            {logs.length} EVENTS
          </span>
        </div>
        <button
          type="button"
          className="text-slate-400 hover:text-slate-200 transition p-0.5"
        >
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="log-scroll flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[11px]">
          {logs.map((log) => {
            const isFire = log.text.includes("FIRE");
            const isImpact = log.text.includes("IMPACT");
            const isLock = log.text.includes("locked") || log.text.includes("LOCKED");

            return (
              <div
                key={log.id}
                className={`flex items-start gap-2 px-2 py-0.5 rounded ${
                  isFire
                    ? "bg-amber-950/40 text-amber-300 border border-amber-800/40"
                    : isImpact
                    ? "bg-rose-950/40 text-rose-300 border border-rose-800/40"
                    : isLock
                    ? "bg-cyan-950/30 text-cyan-200"
                    : "text-slate-300 hover:bg-slate-900/60"
                }`}
              >
                <span className="text-slate-500 shrink-0 text-[10px] select-none">[{log.ts}]</span>
                <span className="leading-snug">{log.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
