"use client";

import { Activity, Radar, Shield } from "lucide-react";
import type { EngagementMode } from "@/lib/fcsTypes";

type NavbarProps = {
  connected: boolean;
  latencyMs: number;
  mode: EngagementMode;
  gpsCoords: string;
};

const MODE_LABELS: Record<EngagementMode, string> = {
  STANDBY: "STANDBY",
  TRACKING: "TRACKING",
  SOLUTION_READY: "SOLUTION READY",
  FIRE: "FIRE",
  IMPACT: "IMPACT",
  COOLDOWN: "COOLDOWN",
};

const MODE_CLASSES: Record<EngagementMode, string> = {
  STANDBY: "mode-standby",
  TRACKING: "mode-tracking",
  SOLUTION_READY: "mode-solution-ready",
  FIRE: "mode-fire",
  IMPACT: "mode-impact",
  COOLDOWN: "mode-standby",
};

export function Navbar({ connected, latencyMs, mode, gpsCoords }: NavbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1c2a3a] bg-[#0a1018]/90 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-amber-400/30 bg-amber-400/10">
          <Shield className="h-4 w-4 text-amber-300" />
        </div>
        <div>
          <p className="font-mono text-[10px] tracking-[0.22em] text-amber-300/80 uppercase">
            FCS · K9 VAJRA
          </p>
          <h1 className="text-sm font-medium tracking-tight text-slate-100">
            AI Fire Control System — SPH 155mm
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* GPS Coordinates */}
        <div className="hidden md:flex items-center gap-1.5 rounded-md border border-[#1c2a3a] bg-[#070b12] px-2.5 py-1.5">
          <span className="font-mono text-[10px] text-slate-500">GPS</span>
          <span className="font-mono text-xs text-slate-300">{gpsCoords}</span>
        </div>

        {/* Engagement Mode Badge */}
        <div
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-semibold tracking-wider ${MODE_CLASSES[mode]}`}
        >
          <Radar className="h-3.5 w-3.5" />
          {MODE_LABELS[mode]}
        </div>

        {/* Connection Status */}
        <div className="flex items-center gap-2 rounded-full border border-[#1c2a3a] bg-[#070b12] px-3 py-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              connected
                ? "led-ok bg-emerald-400"
                : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
            }`}
          />
          <span className="font-mono text-xs tracking-wide text-slate-300">
            {connected ? "LINK" : "NO LINK"}
          </span>
        </div>

        {/* Latency */}
        <div className="flex items-center gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5">
          <Activity className="h-3.5 w-3.5 text-cyan-300" />
          <span className="font-mono text-xs font-medium text-cyan-200">
            {latencyMs.toFixed(0)}ms
          </span>
        </div>
      </div>
    </header>
  );
}
