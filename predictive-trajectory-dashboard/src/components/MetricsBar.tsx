"use client";

import type { ReactNode } from "react";
import { Clock3, Gauge, Compass, Target, ShieldAlert } from "lucide-react";
import type { EngagementMode } from "@/lib/fcsTypes";

type MetricsBarProps = {
  velocity: number;
  leadAngle: number;
  timeOfFlight: number;
  range: number;
  mode: EngagementMode;
};

function MetricCard({
  icon,
  label,
  value,
  unit,
  highlight = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-1 items-center gap-2.5 rounded-lg border px-3 py-2 ${
        highlight
          ? "border-amber-400/40 bg-amber-950/20"
          : "border-[#1c2a3a] bg-[#0c131c]"
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[9px] tracking-[0.14em] text-slate-400 uppercase truncate">
          {label}
        </p>
        <p className="font-mono text-base font-semibold tracking-tight text-slate-100">
          {value}
          <span className="ml-1 text-[11px] font-normal text-slate-400">{unit}</span>
        </p>
      </div>
    </div>
  );
}

export function MetricsBar({
  velocity,
  leadAngle,
  timeOfFlight,
  range,
  mode,
}: MetricsBarProps) {
  return (
    <footer className="grid shrink-0 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 border-t border-[#1c2a3a] bg-[#0a1018] px-4 py-2.5">
      <MetricCard
        icon={<Gauge className="h-4 w-4" />}
        label="Target Speed"
        value={velocity.toFixed(1)}
        unit="m/s"
      />
      <MetricCard
        icon={<Target className="h-4 w-4" />}
        label="Range to Intercept"
        value={range.toString()}
        unit="m"
      />
      <MetricCard
        icon={<Compass className="h-4 w-4" />}
        label="Target Lead Offset"
        value={leadAngle.toFixed(1)}
        unit="deg"
      />
      <MetricCard
        icon={<Clock3 className="h-4 w-4" />}
        label="Projectile ToF"
        value={timeOfFlight.toFixed(2)}
        unit="sec"
      />
      <MetricCard
        icon={<ShieldAlert className="h-4 w-4 text-amber-400" />}
        label="Fire Control State"
        value={mode}
        unit=""
        highlight={mode === "FIRE" || mode === "SOLUTION_READY"}
      />
    </footer>
  );
}
