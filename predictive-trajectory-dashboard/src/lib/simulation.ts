// =============================================================================
// FCS Simulation Engine — Dummy Data & Ballistic Computation
// =============================================================================
// Provides continuously updating simulation data for the K9 Vajra FCS dashboard.
// All data is procedurally generated to showcase the concept without real hardware.

import type {
  FCSState,
  TargetState,
  PredictedPosition,
  ArtilleryState,
  EnvironmentalData,
  BallisticSolution,
  EngagementMode,
} from "./fcsTypes";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Artillery fixed position (center of tactical map) */
export const ARTILLERY_POS = { x: 0, y: 0, z: 0 };

/** Target patrol waypoints (meters from artillery) */
const PATROL_WAYPOINTS = [
  { x: 2800, y: 1200 },
  { x: 3100, y: 1800 },
  { x: 2600, y: 2400 },
  { x: 2000, y: 2100 },
  { x: 1800, y: 1500 },
  { x: 2200, y: 900 },
];

/** Target patrol speed in m/s (~40 km/h for an armored vehicle) */
const TARGET_SPEED = 11.1;

/** Nominal muzzle velocity for 155mm HE round at standard temp (m/s) */
const NOMINAL_MUZZLE_VELOCITY = 827;

/** Muzzle velocity change per °C of propellant temperature deviation from 21°C */
const MV_TEMP_COEFF = 1.5;

/** Gravity constant */
const GRAVITY = 9.81;

/** Max effective range in meters */
const MAX_RANGE = 40000;

/** Servo max slew rate deg/s */
const MAX_SLEW_RATE = 30;

// -----------------------------------------------------------------------------
// Patrol Path Interpolation
// -----------------------------------------------------------------------------

function getPatrolPosition(timeSeconds: number): {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
} {
  const totalWaypoints = PATROL_WAYPOINTS.length;

  // Calculate total patrol path length
  let totalLength = 0;
  const segLengths: number[] = [];
  for (let i = 0; i < totalWaypoints; i++) {
    const next = (i + 1) % totalWaypoints;
    const dx = PATROL_WAYPOINTS[next].x - PATROL_WAYPOINTS[i].x;
    const dy = PATROL_WAYPOINTS[next].y - PATROL_WAYPOINTS[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLengths.push(len);
    totalLength += len;
  }

  // Time to complete one full loop
  const loopTime = totalLength / TARGET_SPEED;
  const t = ((timeSeconds % loopTime) + loopTime) % loopTime;
  const distTraveled = t * TARGET_SPEED;

  // Find which segment we're on
  let accum = 0;
  for (let i = 0; i < totalWaypoints; i++) {
    const next = (i + 1) % totalWaypoints;
    if (accum + segLengths[i] >= distTraveled) {
      const frac = (distTraveled - accum) / segLengths[i];
      const x =
        PATROL_WAYPOINTS[i].x +
        (PATROL_WAYPOINTS[next].x - PATROL_WAYPOINTS[i].x) * frac;
      const y =
        PATROL_WAYPOINTS[i].y +
        (PATROL_WAYPOINTS[next].y - PATROL_WAYPOINTS[i].y) * frac;

      const dx = PATROL_WAYPOINTS[next].x - PATROL_WAYPOINTS[i].x;
      const dy = PATROL_WAYPOINTS[next].y - PATROL_WAYPOINTS[i].y;
      const len = segLengths[i];
      const vx = (dx / len) * TARGET_SPEED;
      const vy = (dy / len) * TARGET_SPEED;

      // Heading: 0 = North (+Y), clockwise
      const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

      return { x, y, vx, vy, heading };
    }
    accum += segLengths[i];
  }

  // Fallback
  return {
    x: PATROL_WAYPOINTS[0].x,
    y: PATROL_WAYPOINTS[0].y,
    vx: 0,
    vy: TARGET_SPEED,
    heading: 0,
  };
}

// -----------------------------------------------------------------------------
// Environmental Data Generator (slowly drifting)
// -----------------------------------------------------------------------------

function generateEnvironment(timeSeconds: number): EnvironmentalData {
  const windBase = 3.5;
  const windVar = 2.0 * Math.sin(timeSeconds * 0.02) + 0.5 * Math.sin(timeSeconds * 0.07);
  const windDirBase = 315; // NW
  const windDirVar = 20 * Math.sin(timeSeconds * 0.015);

  return {
    windSpeed: Math.max(0.5, windBase + windVar),
    windDirection: ((windDirBase + windDirVar) % 360 + 360) % 360,
    temperature: 34.2 + 1.5 * Math.sin(timeSeconds * 0.005),
    pressure: 1013.25 + 2 * Math.sin(timeSeconds * 0.003),
    propellantTemp: 38.0 + 3 * Math.sin(timeSeconds * 0.008),
    humidity: 62 + 8 * Math.sin(timeSeconds * 0.01),
  };
}

// -----------------------------------------------------------------------------
// Ballistic Solution Computer
// -----------------------------------------------------------------------------

export function computeBallisticSolution(
  target: TargetState,
  predicted: PredictedPosition,
  artillery: { x: number; y: number; z: number },
  env: EnvironmentalData
): BallisticSolution {
  // Range to predicted intercept
  const dx = predicted.x - artillery.x;
  const dy = predicted.y - artillery.y;
  const dz = predicted.z - artillery.z;
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (range > MAX_RANGE || range < 100) {
    return {
      status: "OUT_OF_RANGE",
      range,
      timeOfFlight: 0,
      interceptX: predicted.x,
      interceptY: predicted.y,
      interceptZ: predicted.z,
      solutionAzimuth: 0,
      solutionElevation: 0,
      leadAngle: 0,
      muzzleVelocity: NOMINAL_MUZZLE_VELOCITY,
      windDriftCorrection: 0,
      maxRange: MAX_RANGE,
    };
  }

  // Adjusted muzzle velocity for propellant temperature
  const tempDelta = env.propellantTemp - 21.0;
  const muzzleVel = NOMINAL_MUZZLE_VELOCITY + tempDelta * MV_TEMP_COEFF;

  // Simplified ToF calculation (flat fire approximation for demo)
  const horizontalRange = Math.sqrt(dx * dx + dy * dy);
  // Using iterative approach: ToF ≈ range / (muzzleVel * cos(elevation))
  // Start with low-angle approximation
  const sinElev =
    (GRAVITY * horizontalRange) / (muzzleVel * muzzleVel);
  const elevRad = 0.5 * Math.asin(Math.min(1, Math.max(-1, sinElev)));
  const elevDeg = (elevRad * 180) / Math.PI;

  const tof = horizontalRange / (muzzleVel * Math.cos(elevRad));

  // Azimuth to predicted intercept (0=North, clockwise)
  const azimuthRad = Math.atan2(dx, dy);
  const azimuthDeg = ((azimuthRad * 180) / Math.PI + 360) % 360;

  // Lead angle (angle between current target and predicted intercept from artillery)
  const dxCurrent = target.x - artillery.x;
  const dyCurrent = target.y - artillery.y;
  const azToCurrent = Math.atan2(dxCurrent, dyCurrent);
  const leadAngle = Math.abs(((azimuthRad - azToCurrent) * 180) / Math.PI);

  // Wind drift correction (simplified crosswind component)
  const windRad = (env.windDirection * Math.PI) / 180;
  const firingRad = azimuthRad;
  const crosswindAngle = windRad - firingRad;
  const crosswind = env.windSpeed * Math.sin(crosswindAngle);
  const windDrift = 0.5 * crosswind * tof * tof * 0.01; // simplified drift

  return {
    status: "VALID",
    range: Math.round(range),
    timeOfFlight: Math.round(tof * 100) / 100,
    interceptX: predicted.x,
    interceptY: predicted.y,
    interceptZ: predicted.z,
    solutionAzimuth: Math.round(azimuthDeg * 10) / 10,
    solutionElevation: Math.round(Math.max(5, Math.min(70, elevDeg)) * 10) / 10,
    leadAngle: Math.round(leadAngle * 10) / 10,
    muzzleVelocity: Math.round(muzzleVel),
    windDriftCorrection: Math.round(windDrift * 10) / 10,
    maxRange: MAX_RANGE,
  };
}

// -----------------------------------------------------------------------------
// Predict Future Target Position
// -----------------------------------------------------------------------------

function predictTarget(
  target: TargetState,
  tofEstimate: number
): PredictedPosition {
  // Linear extrapolation with small curvature noise
  return {
    x: target.x + target.vx * tofEstimate,
    y: target.y + target.vy * tofEstimate,
    z: 0,
    timeOffset: tofEstimate,
  };
}

// -----------------------------------------------------------------------------
// Full Simulation State Generator
// -----------------------------------------------------------------------------

/** Generate the complete FCS state for a given time (seconds since start) */
export function generateFCSState(
  timeSeconds: number,
  mode: EngagementMode = "TRACKING"
): FCSState {
  // 1. Target patrol position
  const patrol = getPatrolPosition(timeSeconds);
  const target: TargetState = {
    id: "TGT-ALPHA-01",
    x: patrol.x,
    y: patrol.y,
    z: 0,
    vx: patrol.vx,
    vy: patrol.vy,
    heading: patrol.heading,
    speed: TARGET_SPEED,
    confidence: 0.92 + 0.06 * Math.sin(timeSeconds * 0.5),
    classification: "VEHICLE_ARMORED",
    timestamp: Date.now() / 1000,
  };

  // 2. Environment
  const environment = generateEnvironment(timeSeconds);

  // 3. Initial ToF estimate for prediction
  const roughRange = Math.sqrt(target.x ** 2 + target.y ** 2);
  const roughTof = roughRange / NOMINAL_MUZZLE_VELOCITY + 2; // crude estimate

  // 4. Predicted position
  const predictedPosition = predictTarget(target, roughTof);

  // 5. Artillery state
  const dxPred = predictedPosition.x - ARTILLERY_POS.x;
  const dyPred = predictedPosition.y - ARTILLERY_POS.y;
  const targetAz =
    ((Math.atan2(dxPred, dyPred) * 180) / Math.PI + 360) % 360;

  const artillery: ArtilleryState = {
    x: ARTILLERY_POS.x,
    y: ARTILLERY_POS.y,
    z: ARTILLERY_POS.z,
    azimuth: targetAz, // will be lerped in component
    elevation: 25, // will be updated by ballistic solution
    targetAzimuth: targetAz,
    targetElevation: 25,
    slewRate: MAX_SLEW_RATE,
    status: mode === "FIRE" ? "FIRING" : mode === "TRACKING" || mode === "SOLUTION_READY" ? "SLEWING" : "READY",
  };

  // 6. Full ballistic solution
  const ballistic = computeBallisticSolution(
    target,
    predictedPosition,
    ARTILLERY_POS,
    environment
  );

  // Update artillery elevation from solution
  if (ballistic.status === "VALID") {
    artillery.elevation = ballistic.solutionElevation;
    artillery.targetElevation = ballistic.solutionElevation;
    artillery.targetAzimuth = ballistic.solutionAzimuth;
    artillery.azimuth = ballistic.solutionAzimuth;
  }

  return {
    mode,
    target,
    predictedPosition,
    artillery,
    environment,
    ballistic,
    gpsCoords: "26°08'12\"N 91°44'36\"E",
    uptimeSeconds: Math.floor(timeSeconds),
  };
}

// -----------------------------------------------------------------------------
// FCS Log Templates
// -----------------------------------------------------------------------------

export const FCS_LOG_TEMPLATES = {
  STANDBY: [
    "[FCS]: System initialized — awaiting ISR feed",
    "[SERVO]: Turret in stow position, servos idle",
    "[ANEMOMETER]: Sonic anemometer array online",
  ],
  TRACKING: [
    "[ISR LINK]: Drone feed acquired — streaming 30 fps",
    "[AI ENGINE]: YOLOv8 target detection active",
    "[TRACKER]: Target locked — ID: TGT-ALPHA-01 (Armored Vehicle)",
    "[FCS]: Computing predictive trajectory...",
    "[ANEMOMETER]: Wind data streaming — 3D sonic array",
  ],
  SOLUTION_READY: [
    "[BALLISTIC]: Firing solution computed",
    "[SERVO]: Azimuth slewing to solution bearing",
    "[SERVO]: Elevation adjusting for calculated ToF",
    "[FCS]: SOLUTION READY — awaiting FIRE command",
  ],
  FIRE: [
    "[FCS]: ⚡ FIRE COMMAND ISSUED ⚡",
    "[SERVO]: Barrel locked at firing solution",
    "[BREECH]: Round chambered — 155mm HE",
    "[FCS]: ROUND AWAY — tracking flight...",
  ],
  IMPACT: [
    "[FCS]: ✦ IMPACT CONFIRMED — splash observed at predicted coordinates",
    "[TRACKER]: Target in blast radius — overpressure damage assessed",
    "[FCS]: Battle damage assessment in progress...",
  ],
} as const;

// For the tactical map normalization
export const MAP_RANGE = 4000; // meters — radius of tactical map view
