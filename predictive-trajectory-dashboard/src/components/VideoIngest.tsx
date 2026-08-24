"use client";

import { useCallback, useRef, useState } from "react";
import { Film, Loader2, Upload, Crosshair } from "lucide-react";

type VideoIngestProps = {
  onFileSelected: (file: File) => void;
  isAnalyzing: boolean;
  processedVideoUrl: string | null;
};

export function VideoIngest({
  onFileSelected,
  isAnalyzing,
  processedVideoUrl,
}: VideoIngestProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"processed" | "original">("processed");

  const acceptFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/")) return;
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      const url = URL.createObjectURL(file);
      setOriginalUrl(url);
      setFileName(file.name);
      setViewMode("processed");
      onFileSelected(file);
    },
    [onFileSelected, originalUrl]
  );

  const activeVideoUrl =
    viewMode === "processed" && processedVideoUrl
      ? processedVideoUrl
      : originalUrl;

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#1c2a3a] bg-[#0c131c]">
      <header className="flex items-center justify-between border-b border-[#1c2a3a] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-cyan-300" />
          <h2 className="text-sm font-medium text-slate-200">UAV Drone ISR Feed</h2>
        </div>
        {processedVideoUrl && (
          <div className="flex items-center gap-1 rounded bg-[#070b12] p-1 border border-[#1c2a3a]">
            <button
              type="button"
              onClick={() => setViewMode("processed")}
              className={`px-2 py-0.5 font-mono text-[10px] uppercase rounded transition ${
                viewMode === "processed"
                  ? "bg-cyan-400/20 text-cyan-300 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              YOLO Tracked
            </button>
            <button
              type="button"
              onClick={() => setViewMode("original")}
              className={`px-2 py-0.5 font-mono text-[10px] uppercase rounded transition ${
                viewMode === "original"
                  ? "bg-cyan-400/20 text-cyan-300 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Raw Optical
            </button>
          </div>
        )}
        <span className="font-mono text-[10px] tracking-wider text-slate-500 uppercase">
          {fileName ? `FEED: ${fileName}` : "SIMULATED DRONE LINK"}
        </span>
      </header>

      <div className="flex flex-1 flex-col p-3 min-h-0">
        {isAnalyzing ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-[#1c2a3a] bg-[#05080d] p-6 text-center">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-cyan-400" />
            <p className="font-mono text-sm font-medium text-cyan-200">
              YOLOv8 Hunter-Killer Pipeline Processing...
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500">
              Detecting armored targets & computing predictive trajectories
            </p>
          </div>
        ) : activeVideoUrl ? (
          <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-md border border-[#1c2a3a] bg-black">
            <video
              key={activeVideoUrl}
              src={activeVideoUrl}
              controls
              autoPlay
              muted
              loop
              className="max-h-full w-full object-contain"
            />
            <div className="absolute top-2 left-2 pointer-events-none flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded border border-cyan-500/30">
              <Crosshair className="h-3 w-3 text-red-500 animate-pulse" />
              <span className="font-mono text-[9px] text-cyan-300 uppercase tracking-wider">UAV-ALT: 450m • OPTICAL 4K</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) acceptFile(file);
            }}
            className={`flex flex-1 flex-col items-center justify-center rounded-md border border-dashed p-6 text-center transition ${
              dragOver
                ? "border-cyan-400 bg-cyan-400/10"
                : "border-[#2a3d52] bg-[#070b12] hover:border-cyan-400/50"
            }`}
          >
            <Upload className="mb-2 h-7 w-7 text-cyan-300/80" />
            <p className="text-sm font-medium text-slate-200">Ingest Drone Target Video</p>
            <p className="mt-1 font-mono text-xs text-slate-500">
              Drag & drop MP4 target footage or click to browse
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-700/60 font-mono text-[10px] text-cyan-400/80">
              <span>Auto-Sim active when idle</span>
            </div>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) acceptFile(file);
          }}
        />
      </div>
    </section>
  );
}
