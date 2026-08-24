"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, Zap, RotateCcw } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { AnalyticsSidebar, type FCSLogEntry } from "@/components/AnalyticsSidebar";
import { VideoIngest } from "@/components/VideoIngest";
import { TurretViewport } from "@/components/TurretViewport";
import { TacticalMap } from "@/components/TacticalMap";
import { EnvironmentPanel } from "@/components/EnvironmentPanel";
import { MetricsBar } from "@/components/MetricsBar";
import { generateFCSState, FCS_LOG_TEMPLATES } from "@/lib/simulation";
import type { FCSState, EngagementMode, AmmoType } from "@/lib/fcsTypes";
import { fetchSystemStatus, uploadAndAnalyzeVideo, type VideoAnalysisResult } from "@/lib/api";

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

function makeLog(text: string): FCSLogEntry {
  return { id: `${Date.now()}-${Math.random()}`, ts: stamp(), text };
}

const SEED_LOGS: FCSLogEntry[] = [
  { id: "seed-1", ts: "00:00:00.000", text: "[FCS]: K9 VAJRA Fire Control System initialized" },
  { id: "seed-2", ts: "00:00:00.010", text: "[SERVO]: Electro-hydraulic drive controllers online" },
  { id: "seed-3", ts: "00:00:00.020", text: "[ANEMOMETER]: 3D sonic anemometer array streaming @ 20Hz" },
  { id: "seed-4", ts: "00:00:00.030", text: "[ISR LINK]: UAV drone tracking stream connected" },
];

export function Dashboard() {
  const [connected, setConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState(0);
  const [logs, setLogs] = useState<FCSLogEntry[]>(SEED_LOGS);

  const [mode, setMode] = useState<EngagementMode>("TRACKING");
  const [selectedAmmo, setSelectedAmmo] = useState<AmmoType>("155MM_PGM_EXCALIBUR");
  const [fcsState, setFcsState] = useState<FCSState>(() => generateFCSState(0, "TRACKING"));
  const [targetTrail, setTargetTrail] = useState<Array<{ x: number; y: number }>>([]);
  const [isFiring, setIsFiring] = useState(false);
  const [isImpact, setIsImpact] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<VideoAnalysisResult | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);
  const lastTrailPushRef = useRef<number>(0);

  const pushLog = useCallback((text: string) => {
    setLogs((prev) => [makeLog(text), ...prev].slice(0, 50));
  }, []);

  // Poll backend health status
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const { latencyMs: l } = await fetchSystemStatus();
        setConnected(true);
        setLatencyMs(l);
      } catch {
        setConnected(false);
        setLatencyMs(0);
      }
    };

    checkHealth();
    const interval = window.setInterval(checkHealth, 3000);
    return () => window.clearInterval(interval);
  }, []);

  // Main 60fps procedural simulation loop
  useEffect(() => {
    let frameId: number;

    const tick = () => {
      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
      const state = generateFCSState(elapsedSec, mode);
      setFcsState(state);

      // Record target breadcrumb trail every 250ms
      const now = Date.now();
      if (now - lastTrailPushRef.current > 250) {
        lastTrailPushRef.current = now;
        setTargetTrail((prev) => [...prev.slice(-35), { x: state.target.x, y: state.target.y }]);
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    rafRef.current = frameId;

    return () => cancelAnimationFrame(frameId);
  }, [mode]);

  // Handle Video Upload to FastAPI Backend
  const handleFileSelected = useCallback(
    async (file: File) => {
      pushLog(`[ISR FEED]: Uploading UAV drone footage: ${file.name}`);
      setIsAnalyzing(true);

      try {
        const result = await uploadAndAnalyzeVideo(file);
        setAnalysisResult(result);
        setIsAnalyzing(false);

        pushLog(`[AI TRACKER]: Video analysis complete (${result.total_frames} frames)`);
        pushLog(`[AI TRACKER]: Target confirmed in ${result.detected_frames} frames`);
        if (result.summary.latest_intercept) {
          pushLog(
            `[BALLISTICS]: Intercept calculated! ToF=${result.summary.latest_intercept.time_of_flight}s, Pan=${result.summary.latest_intercept.pan_angle_deg}°`
          );
        }
      } catch (err) {
        setIsAnalyzing(false);
        const errMessage = err instanceof Error ? err.message : String(err);
        pushLog(`[!] Vision Pipeline Error: ${errMessage}`);
      }
    },
    [pushLog]
  );

  // Execute Fire Command Sequence
  const handleFireCommand = useCallback(() => {
    if (isFiring || mode === "FIRE") return;

    setMode("FIRE");
    setIsFiring(true);
    setIsImpact(false);

    FCS_LOG_TEMPLATES.FIRE.forEach((line, i) => {
      window.setTimeout(() => pushLog(line), 150 * i);
    });

    // Flight time simulation
    const flightTimeMs = Math.max(1200, fcsState.ballistic.timeOfFlight * 350);

    // Reset firing state after recoil
    window.setTimeout(() => {
      setIsFiring(false);
    }, 700);

    // Trigger Impact
    window.setTimeout(() => {
      setMode("IMPACT");
      setIsImpact(true);

      FCS_LOG_TEMPLATES.IMPACT.forEach((line, i) => {
        window.setTimeout(() => pushLog(line), 120 * i);
      });

      // Return to tracking after impact assessment
      window.setTimeout(() => {
        setIsImpact(false);
        setMode("TRACKING");
        pushLog("[FCS]: Resuming active target tracking and solution computation");
      }, 3000);
    }, flightTimeMs);
  }, [fcsState.ballistic.timeOfFlight, isFiring, mode, pushLog]);

  return (
    <div className="telemetry-grid flex h-screen flex-col overflow-hidden text-slate-100">
      <Navbar
        connected={connected}
        latencyMs={latencyMs}
        mode={mode}
        gpsCoords={fcsState.gpsCoords}
      />

      <main className="flex min-h-0 flex-1 flex-col p-2.5 gap-2.5">
        {/* 4-Quadrant Main Grid */}
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2 gap-2.5">
          {/* Top Left: UAV Drone Video Feed */}
          <div className="flex min-h-0 flex-col">
            <VideoIngest
              onFileSelected={handleFileSelected}
              isAnalyzing={isAnalyzing}
              processedVideoUrl={analysisResult?.processed_video_url ?? null}
            />
          </div>

          {/* Top Right: 3D Turret & Barrel Viewport */}
          <div className="flex min-h-0 flex-col">
            <TurretViewport
              azimuth={fcsState.artillery.azimuth}
              elevation={fcsState.artillery.elevation}
              isFiring={isFiring}
              status={fcsState.artillery.status}
            />
          </div>

          {/* Bottom Left: Tactical Overhead Map */}
          <div className="flex min-h-0 flex-col">
            <TacticalMap
              target={fcsState.target}
              predicted={fcsState.predictedPosition}
              artilleryAzimuth={fcsState.artillery.azimuth}
              ballisticRange={fcsState.ballistic.range}
              ballisticStatus={fcsState.ballistic.status}
              targetTrail={targetTrail}
              isImpact={isImpact}
              selectedAmmo={selectedAmmo}
            />
          </div>

          {/* Bottom Right: Meteorological & Ballistics Readout + Fire Control Trigger */}
          <div className="flex min-h-0 flex-col gap-2">
            <EnvironmentPanel
              env={fcsState.environment}
              ballistic={fcsState.ballistic}
              artillery={fcsState.artillery}
              selectedAmmo={selectedAmmo}
              onSelectAmmo={(ammo) => {
                setSelectedAmmo(ammo);
                pushLog(`[MUNITION SELECT]: Switched active ordnance to ${ammo}`);
              }}
            />

            {/* Fire Action Command Bar */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFireCommand}
                disabled={isFiring || mode === "FIRE"}
                className={`flex-1 flex items-center justify-center gap-2.5 h-12 rounded-lg font-mono text-sm tracking-[0.16em] uppercase font-bold transition ${
                  mode === "FIRE"
                    ? "bg-rose-600 text-white animate-pulse"
                    : "bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 shadow-lg shadow-orange-950/40 fire-ready"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Zap className="h-4 w-4 fill-current" />
                {mode === "FIRE"
                  ? "ROUND IN FLIGHT..."
                  : mode === "IMPACT"
                  ? "IMPACT CONFIRMED"
                  : "ENGAGE & FIRE 155MM (PREDICTIVE INTERCEPT)"}
              </button>

              <button
                type="button"
                title="Reset simulation time"
                onClick={() => {
                  startTimeRef.current = Date.now();
                  setTargetTrail([]);
                  pushLog("[FCS]: Simulation patrol cycle reset to T=0");
                }}
                className="h-12 w-12 flex items-center justify-center rounded-lg border border-[#1c2a3a] bg-[#0c131c] text-slate-400 hover:text-slate-200 hover:border-cyan-400/40 transition"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tactical Metrics Bar */}
        <MetricsBar
          velocity={fcsState.target.speed}
          leadAngle={fcsState.ballistic.leadAngle}
          timeOfFlight={fcsState.ballistic.timeOfFlight}
          range={fcsState.ballistic.range}
          mode={mode}
        />

        {/* Collapsible Telemetry Log Stream */}
        <AnalyticsSidebar logs={logs} />
      </main>
    </div>
  );
}
