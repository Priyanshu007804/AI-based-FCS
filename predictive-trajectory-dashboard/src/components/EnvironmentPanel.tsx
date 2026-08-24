"use client";

import { Wind, Thermometer, Compass, Gauge, Crosshair, ShieldCheck, Target } from "lucide-react";
import { type EnvironmentalData, type BallisticSolution, type ArtilleryState, type AmmoType, AMMO_SPECS } from "@/lib/fcsTypes";

type EnvironmentPanelProps = {
  env: EnvironmentalData;
  ballistic: BallisticSolution;
  artillery: ArtilleryState;
  selectedAmmo: AmmoType;
  onSelectAmmo: (ammo: AmmoType) => void;
};

function getCompassHeading(deg: number): string {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return directions[index];
}

export function EnvironmentPanel({
  env,
  ballistic,
  artillery,
  selectedAmmo,
  onSelectAmmo,
}: EnvironmentPanelProps) {
  const currentSpec = AMMO_SPECS[selectedAmmo];

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#1c2a3a] bg-[#0c131c]">
      <header className="flex items-center justify-between border-b border-[#1c2a3a] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Wind className="h-4 w-4 text-cyan-300" />
          <h2 className="text-sm font-medium text-slate-200">
            Meteorological & Ballistics Readout
          </h2>
        </div>
        <span className="font-mono text-[10px] tracking-wider text-emerald-400 uppercase">
          3D Sonic Array Online
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 log-scroll">
        {/* Ammunition Munition Selector Bar */}
        <div className="rounded border border-[#1c2a3a] bg-[#070b12] p-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[11px] font-semibold text-amber-300 uppercase flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-amber-400" />
              Munition Select (HE vs. PGM)
            </span>
            <span className="font-mono text-[10px] text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">
              CEP: {currentSpec.cepMeters}m
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {(Object.keys(AMMO_SPECS) as AmmoType[]).map((key) => {
              const spec = AMMO_SPECS[key];
              const isSelected = selectedAmmo === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectAmmo(key)}
                  className={`flex flex-col items-center justify-center p-1.5 rounded border text-center transition ${
                    isSelected
                      ? spec.guided
                        ? "border-emerald-400 bg-emerald-950/40 text-emerald-200 font-semibold"
                        : "border-amber-400 bg-amber-950/40 text-amber-200 font-semibold"
                      : "border-[#1c2a3a] bg-[#0c131c] text-slate-400 hover:text-slate-200 hover:border-slate-700"
                  }`}
                >
                  <span className="font-mono text-[10px] uppercase truncate w-full">{spec.shortName}</span>
                  <span className="font-mono text-[9px] text-slate-400">
                    {spec.guided ? "GPS/INS" : "Unguided"}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-2 font-mono text-[10px] text-slate-400 bg-[#0c131c] p-1.5 rounded border border-[#1c2a3a]/60">
            {currentSpec.description}
          </p>
        </div>

        {/* Environmental / Wind Section */}
        <div className="rounded border border-[#1c2a3a] bg-[#070b12] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5 text-cyan-400" />
              Wind Telemetry (Sonic Anemometer)
            </span>
            <span className="font-mono text-[10px] text-cyan-400 bg-cyan-950/50 px-1.5 py-0.5 rounded border border-cyan-800/40">
              {getCompassHeading(env.windDirection)} ({env.windDirection.toFixed(0)}°)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded bg-[#0c131c] p-2 border border-[#1c2a3a]/60">
              <span className="block font-mono text-[9px] text-slate-500 uppercase">Wind Velocity</span>
              <span className="font-mono text-base font-bold text-cyan-200">
                {env.windSpeed.toFixed(1)} <span className="text-xs font-normal text-slate-400">m/s</span>
              </span>
            </div>
            <div className="rounded bg-[#0c131c] p-2 border border-[#1c2a3a]/60">
              <span className="block font-mono text-[9px] text-slate-500 uppercase">Lateral Drift Corr.</span>
              <span className="font-mono text-base font-bold text-amber-300">
                {ballistic.windDriftCorrection > 0 ? `+${ballistic.windDriftCorrection.toFixed(1)}` : ballistic.windDriftCorrection.toFixed(1)}{" "}
                <span className="text-xs font-normal text-slate-400">m</span>
              </span>
            </div>
          </div>
        </div>

        {/* Atmosphere & Propellant Thermal */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-[#1c2a3a] bg-[#070b12] p-2.5">
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Thermometer className="h-3.5 w-3.5 text-rose-400" />
              <span className="font-mono text-[10px] uppercase">Ambient Temp</span>
            </div>
            <span className="font-mono text-sm font-semibold text-slate-200">
              {env.temperature.toFixed(1)}°C <span className="text-[10px] text-slate-500 font-normal">({env.humidity.toFixed(0)}% RH)</span>
            </span>
          </div>

          <div className="rounded border border-[#1c2a3a] bg-[#070b12] p-2.5">
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Gauge className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono text-[10px] uppercase">Charge Temp</span>
            </div>
            <span className="font-mono text-sm font-semibold text-amber-200">
              {env.propellantTemp.toFixed(1)}°C <span className="text-[10px] text-emerald-400 font-normal">(MV +{((env.propellantTemp - 21) * 1.5).toFixed(0)} m/s)</span>
            </span>
          </div>
        </div>

        {/* Firing Solution & Servo Command Status */}
        <div className="rounded border border-[#1c2a3a] bg-[#070b12] p-3">
          <span className="font-mono text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-1.5 mb-2">
            <Crosshair className="h-3.5 w-3.5 text-emerald-400" />
            Active Ballistic Solution ({currentSpec.shortName})
          </span>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-[#0c131c] p-2 border border-[#1c2a3a]/60">
              <span className="block font-mono text-[9px] text-slate-500 uppercase">Computed Range</span>
              <span className="font-mono text-sm font-bold text-slate-100">{ballistic.range} m</span>
            </div>
            <div className="rounded bg-[#0c131c] p-2 border border-[#1c2a3a]/60">
              <span className="block font-mono text-[9px] text-slate-500 uppercase">Solution AZ</span>
              <span className="font-mono text-sm font-bold text-cyan-300">{ballistic.solutionAzimuth.toFixed(1)}°</span>
            </div>
            <div className="rounded bg-[#0c131c] p-2 border border-[#1c2a3a]/60">
              <span className="block font-mono text-[9px] text-slate-500 uppercase">Solution EL</span>
              <span className="font-mono text-sm font-bold text-cyan-300">{ballistic.solutionElevation.toFixed(1)}°</span>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-[#1c2a3a]/50 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Muzzle Vel: <strong className="text-slate-200">{ballistic.muzzleVelocity} m/s</strong></span>
            <span>Guidance: <strong className={currentSpec.guided ? "text-emerald-400 flex items-center gap-1" : "text-amber-400"}>{currentSpec.guided ? "GPS/INS ACTIVE" : "UNGUIDED BAL."}</strong></span>
          </div>
        </div>
      </div>
    </section>
  );
}
