"use client";

import { useMemo, useState } from "react";
import { Map, ZoomIn, ZoomOut, Maximize2, Target } from "lucide-react";
import { type TargetState, type PredictedPosition, type AmmoType, AMMO_SPECS } from "@/lib/fcsTypes";

type TacticalMapProps = {
  target: TargetState;
  predicted: PredictedPosition;
  artilleryAzimuth: number;
  ballisticRange: number;
  ballisticStatus: string;
  targetTrail: Array<{ x: number; y: number }>;
  isImpact: boolean;
  selectedAmmo?: AmmoType;
};

type ViewScaleMode = "AUTO" | "2KM" | "4KM";

export function TacticalMap({
  target,
  predicted,
  artilleryAzimuth,
  ballisticRange,
  ballisticStatus,
  targetTrail,
  isImpact,
  selectedAmmo = "155MM_HE",
}: TacticalMapProps) {
  const [scaleMode, setScaleMode] = useState<ViewScaleMode>("AUTO");

  const ammoSpec = AMMO_SPECS[selectedAmmo];
  const cepMeters = ammoSpec.cepMeters;
  const isGuided = ammoSpec.guided;

  // Determine dynamic viewport range based on scale mode
  const currentRangeMeters = useMemo(() => {
    if (scaleMode === "2KM") return 2000;
    if (scaleMode === "4KM") return 4000;
    // AUTO mode: dynamically zoom into active target distance + padding
    const distToTarget = Math.hypot(target.x, target.y);
    return Math.max(1200, Math.min(4500, distToTarget * 1.3));
  }, [scaleMode, target.x, target.y]);

  /** Convert world meters to SVG viewport coordinates (0–100) */
  const toSVG = (x: number, y: number) => {
    // SPH Artillery at center-bottom (50, 85) for optimal forward visibility, or center (50, 50)
    // Here we place SPH at (50, 80) so target forward engagement sector fills the map nicely!
    const scale = 65 / currentRangeMeters;
    return {
      cx: 50 + x * scale,
      cy: 80 - y * scale,
    };
  };

  const artilleryPos = toSVG(0, 0);
  const targetPos = toSVG(target.x, target.y);
  const predictedPos = toSVG(predicted.x, predicted.y);

  // Velocity vector endpoint
  const velScale = 12; // 12 seconds forward projection
  const velEnd = toSVG(
    target.x + target.vx * velScale,
    target.y + target.vy * velScale
  );

  // Artillery azimuth line endpoint
  const azRad = ((artilleryAzimuth - 90) * Math.PI) / 180;
  const azLineEnd = {
    cx: artilleryPos.cx + Math.cos(azRad) * 75,
    cy: artilleryPos.cy - Math.sin(azRad) * 75,
  };

  // CEP and Blast radius circles in SVG scale
  const cepRadiusSVG = Math.max(1.8, (cepMeters / currentRangeMeters) * 65);
  const blastRadiusSVG = (45 / currentRangeMeters) * 65;

  // Normalize trail to SVG
  const svgTrail = useMemo(
    () => targetTrail.map((p) => toSVG(p.x, p.y)),
    [targetTrail, currentRangeMeters]
  );

  // Distance gap between current target and predicted intercept
  const leadDistance = Math.hypot(predicted.x - target.x, predicted.y - target.y);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#1c2a3a] bg-[#0c131c]">
      {/* Header with Zoom & View Controls */}
      <header className="flex items-center justify-between border-b border-[#1c2a3a] px-4 py-2">
        <div className="flex items-center gap-2">
          <Map className="h-4 w-4 text-cyan-300" />
          <h2 className="text-sm font-medium text-slate-200">
            Tactical Overhead Map
          </h2>
        </div>

        {/* Dynamic Zoom Toggles */}
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline font-mono text-[10px] text-slate-500 mr-1">VIEW:</span>
          <button
            type="button"
            onClick={() => setScaleMode("AUTO")}
            className={`px-2 py-0.5 font-mono text-[10px] rounded transition border ${
              scaleMode === "AUTO"
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold"
                : "bg-[#070b12] text-slate-400 border-[#1c2a3a] hover:text-slate-200"
            }`}
          >
            AUTOFOCUS
          </button>
          <button
            type="button"
            onClick={() => setScaleMode("2KM")}
            className={`px-2 py-0.5 font-mono text-[10px] rounded transition border ${
              scaleMode === "2KM"
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold"
                : "bg-[#070b12] text-slate-400 border-[#1c2a3a] hover:text-slate-200"
            }`}
          >
            2KM
          </button>
          <button
            type="button"
            onClick={() => setScaleMode("4KM")}
            className={`px-2 py-0.5 font-mono text-[10px] rounded transition border ${
              scaleMode === "4KM"
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold"
                : "bg-[#070b12] text-slate-400 border-[#1c2a3a] hover:text-slate-200"
            }`}
          >
            4KM SECTOR
          </button>
        </div>
      </header>

      {/* Main Tactical Display Box */}
      <div className="relative flex-1 overflow-hidden rounded-b-lg bg-[#04070d]">
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Tactical Grid Pattern */}
          <defs>
            <pattern
              id="tac-grid-large"
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                stroke="rgba(34,211,238,0.12)"
                strokeWidth="0.2"
              />
            </pattern>
            <marker
              id="vel-arrow"
              markerWidth="5"
              markerHeight="5"
              refX="4"
              refY="2.5"
              orient="auto"
            >
              <polygon points="0 0, 5 2.5, 0 5" fill="#f43f5e" />
            </marker>
          </defs>
          <rect width="100" height="100" fill="url(#tac-grid-large)" />

          {/* Range Rings from SPH */}
          {[500, 1000, 1500, 2000, 3000, 4000].map((r) => {
            if (r > currentRangeMeters * 1.4) return null;
            const rSVG = (r / currentRangeMeters) * 65;
            return (
              <g key={r}>
                <circle
                  cx={artilleryPos.cx}
                  cy={artilleryPos.cy}
                  r={rSVG}
                  fill="none"
                  stroke="rgba(34,211,238,0.15)"
                  strokeWidth="0.25"
                  strokeDasharray="1.5 1.5"
                />
                <text
                  x={artilleryPos.cx + rSVG * 0.707 + 0.8}
                  y={artilleryPos.cy - rSVG * 0.707}
                  fontSize="1.8"
                  fill="rgba(34,211,238,0.5)"
                  fontFamily="monospace"
                  dominantBaseline="middle"
                >
                  {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                </text>
              </g>
            );
          })}

          {/* Artillery Azimuth / Servo Line */}
          <line
            x1={artilleryPos.cx}
            y1={artilleryPos.cy}
            x2={azLineEnd.cx}
            y2={azLineEnd.cy}
            stroke="rgba(245,185,66,0.3)"
            strokeWidth="0.4"
            strokeDasharray="1 2"
          />

          {/* Line of Fire: SPH -> Predicted Intercept */}
          <line
            x1={artilleryPos.cx}
            y1={artilleryPos.cy}
            x2={predictedPos.cx}
            y2={predictedPos.cy}
            stroke={isGuided ? "rgba(52,211,153,0.5)" : "rgba(249,115,22,0.5)"}
            strokeWidth="0.5"
            strokeDasharray="2 1.5"
          />

          {/* Target Lead Vector: Target Current -> Predicted Intercept */}
          <line
            x1={targetPos.cx}
            y1={targetPos.cy}
            x2={predictedPos.cx}
            y2={predictedPos.cy}
            stroke="#f5b942"
            strokeWidth="0.6"
            strokeDasharray="1 1"
          />

          {/* Target Trail Breadcrumbs */}
          {svgTrail.map((p, i) => (
            <circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r={0.6}
              fill={`rgba(244,63,94,${0.15 + (i / svgTrail.length) * 0.6})`}
            />
          ))}

          {/* Target Velocity Direction Arrow */}
          <line
            x1={targetPos.cx}
            y1={targetPos.cy}
            x2={velEnd.cx}
            y2={velEnd.cy}
            stroke="#f43f5e"
            strokeWidth="0.5"
            markerEnd="url(#vel-arrow)"
          />

          {/* Munition CEP Circle */}
          <circle
            cx={predictedPos.cx}
            cy={predictedPos.cy}
            r={cepRadiusSVG}
            fill={isGuided ? "rgba(52,211,153,0.1)" : "rgba(245,185,66,0.08)"}
            stroke={isGuided ? "#34d399" : "#f5b942"}
            strokeWidth="0.4"
            strokeDasharray={isGuided ? "none" : "1 1"}
          />

          {/* Predicted Intercept X Crosshair Marker */}
          <g>
            <line
              x1={predictedPos.cx - 2.0}
              y1={predictedPos.cy - 2.0}
              x2={predictedPos.cx + 2.0}
              y2={predictedPos.cy + 2.0}
              stroke={isGuided ? "#34d399" : "#f97316"}
              strokeWidth="0.6"
            />
            <line
              x1={predictedPos.cx + 2.0}
              y1={predictedPos.cy - 2.0}
              x2={predictedPos.cx - 2.0}
              y2={predictedPos.cy + 2.0}
              stroke={isGuided ? "#34d399" : "#f97316"}
              strokeWidth="0.6"
            />
            {/* Outer reticle ring */}
            <circle
              cx={predictedPos.cx}
              cy={predictedPos.cy}
              r="3.2"
              fill="none"
              stroke={isGuided ? "#34d399" : "#f97316"}
              strokeWidth="0.3"
            />
            <text
              x={predictedPos.cx}
              y={predictedPos.cy - 4}
              fontSize="2.2"
              fill={isGuided ? "#34d399" : "#f97316"}
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              {isGuided ? "PGM INTERCEPT (X)" : "PREDICTED (X)"}
            </text>
          </g>

          {/* Current Target Location Marker */}
          <g>
            <circle cx={targetPos.cx} cy={targetPos.cy} r="1.6" fill="#f43f5e">
              <animate
                attributeName="r"
                values="1.6;2.5;1.6"
                dur="1s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={targetPos.cx}
              cy={targetPos.cy}
              r="3.5"
              fill="none"
              stroke="#f43f5e"
              strokeWidth="0.35"
            />
            <text
              x={targetPos.cx}
              y={targetPos.cy + 5.5}
              fontSize="2.2"
              fill="#f43f5e"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              {target.id}
            </text>
          </g>

          {/* SPH Artillery Location Marker */}
          <g>
            <rect
              x={artilleryPos.cx - 2}
              y={artilleryPos.cy - 2}
              width="4"
              height="4"
              fill="#4a6741"
              stroke="#a3e635"
              strokeWidth="0.4"
              rx="0.5"
            />
            <text
              x={artilleryPos.cx}
              y={artilleryPos.cy + 5.5}
              fontSize="2.2"
              fill="#a3e635"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              K9 VAJRA (SPH)
            </text>
          </g>

          {/* Impact Detonation Shockwave */}
          {isImpact && (
            <circle
              cx={predictedPos.cx}
              cy={predictedPos.cy}
              r="0"
              fill="none"
              stroke="#f97316"
              strokeWidth="0.8"
            >
              <animate
                attributeName="r"
                from="0"
                to="15"
                dur="1.2s"
                fill="freeze"
              />
              <animate
                attributeName="opacity"
                from="1"
                to="0"
                dur="1.2s"
                fill="freeze"
              />
            </circle>
          )}
        </svg>

        {/* HUD Telemetry Card Overlay (Top-Left) */}
        <div className="absolute top-2 left-2 rounded border border-cyan-500/30 bg-[#070b12]/90 p-2.5 backdrop-blur font-mono text-[11px] space-y-1 shadow-lg max-w-[220px]">
          <div className="flex items-center justify-between border-b border-[#1c2a3a] pb-1">
            <span className="text-cyan-300 font-bold flex items-center gap-1">
              <Target className="h-3 w-3 text-red-500" />
              {target.id}
            </span>
            <span className="text-slate-400 text-[9px] uppercase">TRACKING</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-500">Speed:</span>
            <span className="font-semibold text-cyan-200">{target.speed.toFixed(1)} m/s</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-500">Heading:</span>
            <span className="font-semibold text-slate-200">{target.heading.toFixed(0)}°</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-500">Lead Offset:</span>
            <span className="font-semibold text-amber-300">+{leadDistance.toFixed(0)} m</span>
          </div>
        </div>

        {/* Ordnance Status Card Overlay (Top-Right) */}
        <div className="absolute top-2 right-2 rounded border border-[#1c2a3a] bg-[#070b12]/90 p-2.5 backdrop-blur font-mono text-[11px] space-y-1 shadow-lg text-right">
          <p className="text-[10px] text-slate-400 uppercase">ACTIVE ORDNANCE</p>
          <p className="font-bold text-amber-300">{ammoSpec.shortName}</p>
          <p className="text-[10px] text-emerald-400">
            {isGuided ? `GPS/INS • CEP ${cepMeters}m` : `UNGUIDED • CEP ${cepMeters}m`}
          </p>
        </div>

        {/* Map Legend Overlay (Bottom Bar) */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded bg-[#070b12]/90 px-3 py-1.5 border border-[#1c2a3a] font-mono text-[10px] backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-lime-400">
              <span className="inline-block h-2 w-2 bg-[#4a6741] border border-lime-400" /> SPH
            </span>
            <span className="flex items-center gap-1 text-rose-400">
              <span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> Target
            </span>
            <span className="flex items-center gap-1 text-amber-400">
              <span className="inline-block h-2 w-2 border border-amber-400 text-[8px] flex items-center justify-center font-bold">X</span> Intercept
            </span>
          </div>
          <span className="text-slate-500 text-[9px] uppercase">
            Viewport: {Math.round(currentRangeMeters)}m Radius
          </span>
        </div>
      </div>
    </section>
  );
}
