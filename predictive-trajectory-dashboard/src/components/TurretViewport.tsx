"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { Crosshair } from "lucide-react";

// =============================================================================
// K9 Vajra SPH 3D Model (Built from Three.js primitives)
// =============================================================================

type SPHModelProps = {
  azimuthDeg: number;
  elevationDeg: number;
  isFiring: boolean;
};

function SPHModel({ azimuthDeg, elevationDeg, isFiring }: SPHModelProps) {
  const turretRef = useRef<THREE.Group>(null);
  const barrelRef = useRef<THREE.Group>(null);
  const recoilRef = useRef<THREE.Group>(null);
  const muzzleFlashRef = useRef<THREE.Mesh>(null);

  // Smooth servo interpolation
  const targetAzRad = useMemo(
    () => THREE.MathUtils.degToRad(-azimuthDeg + 90),
    [azimuthDeg]
  );
  const targetElevRad = useMemo(
    () => THREE.MathUtils.degToRad(-elevationDeg),
    [elevationDeg]
  );

  const recoilState = useRef({ active: false, startTime: 0 });

  useFrame((state) => {
    // Smooth turret rotation (azimuth)
    if (turretRef.current) {
      turretRef.current.rotation.y = THREE.MathUtils.lerp(
        turretRef.current.rotation.y,
        targetAzRad,
        0.05
      );
    }

    // Smooth barrel elevation
    if (barrelRef.current) {
      barrelRef.current.rotation.x = THREE.MathUtils.lerp(
        barrelRef.current.rotation.x,
        targetElevRad,
        0.05
      );
    }

    // Recoil animation
    if (isFiring && !recoilState.current.active) {
      recoilState.current.active = true;
      recoilState.current.startTime = state.clock.elapsedTime;
    }

    if (recoilState.current.active && recoilRef.current) {
      const elapsed = state.clock.elapsedTime - recoilState.current.startTime;
      if (elapsed < 0.5) {
        const t = elapsed / 0.5;
        const recoilOffset = Math.sin(t * Math.PI) * 0.2 * (1 - t);
        recoilRef.current.position.z = -recoilOffset;
      } else {
        recoilRef.current.position.z = 0;
        recoilState.current.active = false;
      }
    }

    // Muzzle flash
    if (muzzleFlashRef.current) {
      if (recoilState.current.active) {
        const elapsed = state.clock.elapsedTime - recoilState.current.startTime;
        muzzleFlashRef.current.visible = elapsed < 0.15;
        const scale = 1 + elapsed * 6;
        muzzleFlashRef.current.scale.setScalar(scale);
      } else {
        muzzleFlashRef.current.visible = false;
      }
    }
  });

  // Materials
  const hullMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#4a6741",
        roughness: 0.6,
        metalness: 0.4,
      }),
    []
  );
  const turretMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3b5233",
        roughness: 0.5,
        metalness: 0.5,
      }),
    []
  );
  const barrelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#222d1f",
        roughness: 0.3,
        metalness: 0.7,
      }),
    []
  );
  const trackMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#181f16",
        roughness: 0.9,
        metalness: 0.2,
      }),
    []
  );

  return (
    <group>
      {/* === Hull Body === */}
      <mesh position={[0, 0.35, 0]} material={hullMat} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.5, 3.5]} />
      </mesh>

      {/* Hull front slope */}
      <mesh
        position={[0, 0.45, 1.6]}
        rotation={[0.4, 0, 0]}
        material={hullMat}
        castShadow
      >
        <boxGeometry args={[1.7, 0.3, 0.6]} />
      </mesh>

      {/* === Tracks (left & right) === */}
      <mesh position={[-1.05, 0.2, 0]} material={trackMat}>
        <boxGeometry args={[0.35, 0.4, 3.8]} />
      </mesh>
      <mesh position={[1.05, 0.2, 0]} material={trackMat}>
        <boxGeometry args={[0.35, 0.4, 3.8]} />
      </mesh>

      {/* === Turret (rotates on Y-axis for azimuth) === */}
      <group ref={turretRef} position={[0, 0.72, -0.3]}>
        {/* Turret body */}
        <mesh material={turretMat} castShadow>
          <boxGeometry args={[1.5, 0.55, 1.8]} />
        </mesh>

        {/* Turret top detail */}
        <mesh position={[0, 0.35, 0]} material={turretMat} castShadow>
          <boxGeometry args={[1.2, 0.15, 1.4]} />
        </mesh>

        {/* Commander's cupola */}
        <mesh position={[-0.35, 0.48, -0.3]}>
          <cylinderGeometry args={[0.15, 0.18, 0.2, 12]} />
          <meshStandardMaterial color="#2a3b24" roughness={0.5} metalness={0.5} />
        </mesh>

        {/* === Barrel Assembly (rotates on X-axis for elevation) === */}
        <group ref={barrelRef} position={[0, 0.1, 0.8]}>
          <group ref={recoilRef}>
            {/* Re-orient barrel — cylinder extends along +Z */}
            <group rotation={[Math.PI / 2, 0, 0]}>
              <mesh position={[0, 1.5, 0]} castShadow>
                <cylinderGeometry args={[0.07, 0.06, 3.0, 16]} />
                <primitive object={barrelMat} attach="material" />
              </mesh>

              {/* Muzzle brake */}
              <mesh position={[0, 3.05, 0]} castShadow>
                <cylinderGeometry args={[0.09, 0.09, 0.18, 16]} />
                <meshStandardMaterial color="#111810" roughness={0.3} metalness={0.7} />
              </mesh>

              {/* Muzzle flash */}
              <mesh ref={muzzleFlashRef} position={[0, 3.25, 0]} visible={false}>
                <sphereGeometry args={[0.2, 12, 12]} />
                <meshBasicMaterial color="#ffaa00" transparent opacity={0.9} />
              </mesh>
            </group>
          </group>

          {/* Barrel cradle */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.22, 0.22, 0.4]} />
            <primitive object={turretMat} attach="material" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// =============================================================================
// HUD Overlay (2D HTML text on top of 3D viewport)
// =============================================================================

type HUDOverlayProps = {
  azimuth: number;
  elevation: number;
  status: string;
};

function HUDOverlay({ azimuth, elevation, status }: HUDOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 p-3 flex flex-col justify-between">
      <div className="flex items-start justify-between">
        {/* Servo position readout */}
        <div className="rounded border border-cyan-400/30 bg-[#070b12]/90 px-3 py-1.5 backdrop-blur shadow-md">
          <p className="font-mono text-[9px] text-cyan-400/70 uppercase tracking-wider">
            Servo Position
          </p>
          <p className="font-mono text-xs font-bold text-cyan-200">
            AZ: {azimuth.toFixed(1)}° &nbsp;|&nbsp; EL: {elevation.toFixed(1)}°
          </p>
        </div>

        {/* Turret status */}
        <div className="rounded border border-amber-400/30 bg-[#070b12]/90 px-3 py-1.5 backdrop-blur shadow-md">
          <p className="font-mono text-[9px] text-amber-300/70 uppercase tracking-wider">
            Turret Servo
          </p>
          <p className="font-mono text-xs font-bold text-amber-200">{status}</p>
        </div>
      </div>

      <div className="text-center">
        <p className="font-mono text-[9px] text-slate-500 bg-[#070b12]/60 inline-block px-2 py-0.5 rounded">
          Drag to orbit 3D view • Scroll to zoom
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Main Turret Viewport Component
// =============================================================================

type TurretViewportProps = {
  azimuth: number;
  elevation: number;
  isFiring: boolean;
  status: string;
};

export function TurretViewport({
  azimuth,
  elevation,
  isFiring,
  status,
}: TurretViewportProps) {
  return (
    <section className="turret-viewport flex min-h-0 flex-1 flex-col rounded-lg border border-[#1c2a3a] bg-[#0c131c]">
      <header className="flex items-center justify-between border-b border-[#1c2a3a] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-medium text-slate-200">
            3D Turret Viewport
          </h2>
        </div>
        <span className="font-mono text-[10px] tracking-wider text-cyan-400 uppercase">
          Electro-Hydraulic Servo Model
        </span>
      </header>

      <div className="relative flex-1 overflow-hidden rounded-b-lg bg-[#05080d]">
        <HUDOverlay azimuth={azimuth} elevation={elevation} status={status} />

        <Canvas
          camera={{ position: [4, 3, 5], fov: 45 }}
          style={{ background: "#05080d" }}
          gl={{ antialias: true, alpha: false }}
        >
          {/* Direct 3D Lighting (No external CDN dependencies) */}
          <ambientLight intensity={0.5} />
          <hemisphereLight intensity={0.6} color="#22d3ee" groundColor="#0c131c" />
          <directionalLight position={[8, 12, 6]} intensity={1.4} castShadow />
          <directionalLight position={[-6, 4, -4]} intensity={0.4} />

          {/* Ground Grid */}
          <Grid
            args={[30, 30]}
            cellSize={0.5}
            cellThickness={0.6}
            cellColor="#1e3220"
            sectionSize={2}
            sectionThickness={1.2}
            sectionColor="#355c38"
            fadeDistance={25}
            fadeStrength={1}
            position={[0, 0, 0]}
          />

          {/* K9 Vajra SPH 3D Model */}
          <SPHModel
            azimuthDeg={azimuth}
            elevationDeg={elevation}
            isFiring={isFiring}
          />

          <OrbitControls
            enablePan={false}
            minDistance={3}
            maxDistance={12}
            maxPolarAngle={Math.PI / 2.05}
          />
        </Canvas>
      </div>
    </section>
  );
}
