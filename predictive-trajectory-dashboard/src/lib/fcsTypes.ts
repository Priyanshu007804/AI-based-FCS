// =============================================================================
// FCS Type Definitions — K9 Vajra SPH Fire Control System
// =============================================================================

/** Engagement mode state machine */
export type EngagementMode =
  | "STANDBY"
  | "TRACKING"
  | "SOLUTION_READY"
  | "FIRE"
  | "IMPACT"
  | "COOLDOWN";

/** Ammunition Munition Types */
export type AmmoType = "155MM_HE" | "155MM_PGM_EXCALIBUR" | "155MM_BONUS";

export interface AmmoSpec {
  id: AmmoType;
  name: string;
  shortName: string;
  guided: boolean;
  cepMeters: number;
  description: string;
}

export const AMMO_SPECS: Record<AmmoType, AmmoSpec> = {
  "155MM_HE": {
    id: "155MM_HE",
    name: "155mm High Explosive (Unguided)",
    shortName: "155mm HE",
    guided: false,
    cepMeters: 35,
    description: "Standard unguided HE shell. High area shockwave dispersion (35m CEP).",
  },
  "155MM_PGM_EXCALIBUR": {
    id: "155MM_PGM_EXCALIBUR",
    name: "155mm PGM Excalibur (GPS/INS)",
    shortName: "PGM Excalibur",
    guided: true,
    cepMeters: 2.5,
    description: "Precision Guided Munition with mid-course GPS/INS guidance (2.5m CEP).",
  },
  "155MM_BONUS": {
    id: "155MM_BONUS",
    name: "155mm BONUS Top-Attack (Sensor-Fuzed)",
    shortName: "155mm BONUS",
    guided: true,
    cepMeters: 8,
    description: "Smart anti-armor munition with IR sensor-fuzed submunitions (8m CEP).",
  },
};

/** Target classification from drone ISR feed */
export type TargetClassification =
  | "VEHICLE_ARMORED"
  | "VEHICLE_SOFT"
  | "INFANTRY_GROUP"
  | "STRUCTURE"
  | "UNKNOWN";

// -----------------------------------------------------------------------------
// Target State (from drone/CV detection)
// -----------------------------------------------------------------------------
export interface TargetState {
  id: string;
  /** Current position in meters (local coordinate frame) */
  x: number;
  y: number;
  z: number;
  /** Velocity vector in m/s */
  vx: number;
  vy: number;
  /** Heading in degrees (0=North, clockwise) */
  heading: number;
  /** Speed magnitude in m/s */
  speed: number;
  /** Detection confidence 0..1 */
  confidence: number;
  /** Classification from AI model */
  classification: TargetClassification;
  /** UNIX timestamp of detection */
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Predicted Target State
// -----------------------------------------------------------------------------
export interface PredictedPosition {
  x: number;
  y: number;
  z: number;
  /** Seconds from now until target reaches this position */
  timeOffset: number;
}

// -----------------------------------------------------------------------------
// Artillery (SPH) State
// -----------------------------------------------------------------------------
export interface ArtilleryState {
  /** Fixed position in meters (local coordinate frame) */
  x: number;
  y: number;
  z: number;
  /** Current barrel azimuth in degrees (0=North, clockwise) */
  azimuth: number;
  /** Current barrel elevation in degrees (0=horizontal, positive=up) */
  elevation: number;
  /** Target azimuth the servo is slewing toward */
  targetAzimuth: number;
  /** Target elevation the servo is slewing toward */
  targetElevation: number;
  /** Turret slew rate in deg/s */
  slewRate: number;
  /** Platform status */
  status: "READY" | "SLEWING" | "FIRING" | "RELOADING" | "OFFLINE";
}

// -----------------------------------------------------------------------------
// Environmental / Meteorological Data (from 3D sonic anemometer + sensors)
// -----------------------------------------------------------------------------
export interface EnvironmentalData {
  /** Wind speed in m/s */
  windSpeed: number;
  /** Wind direction in degrees (0=North, compass bearing FROM which wind blows) */
  windDirection: number;
  /** Ambient temperature in °C */
  temperature: number;
  /** Barometric pressure in hPa */
  pressure: number;
  /** Propellant/charge temperature in °C (affects muzzle velocity) */
  propellantTemp: number;
  /** Relative humidity % */
  humidity: number;
}

// -----------------------------------------------------------------------------
// Ballistic Solution (computed by FCS)
// -----------------------------------------------------------------------------
export interface BallisticSolution {
  /** Status of the solution */
  status: "VALID" | "OUT_OF_RANGE" | "NO_TARGET" | "COMPUTING";
  /** Slant range to predicted intercept in meters */
  range: number;
  /** Time of Flight in seconds */
  timeOfFlight: number;
  /** Predicted intercept coordinates */
  interceptX: number;
  interceptY: number;
  interceptZ: number;
  /** Required barrel azimuth for solution (degrees) */
  solutionAzimuth: number;
  /** Required barrel elevation for solution (degrees) */
  solutionElevation: number;
  /** Calculated lead angle in degrees */
  leadAngle: number;
  /** Calculated muzzle velocity considering propellant temp (m/s) */
  muzzleVelocity: number;
  /** Wind drift correction applied (meters lateral) */
  windDriftCorrection: number;
  /** Max effective range of current charge (m) */
  maxRange: number;
}

// -----------------------------------------------------------------------------
// Servo Command (sent to electro-hydraulic drive)
// -----------------------------------------------------------------------------
export interface ServoCommand {
  targetAzimuth: number;
  targetElevation: number;
  slewRate: number;
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Combined FCS State (full dashboard state)
// -----------------------------------------------------------------------------
export interface FCSState {
  mode: EngagementMode;
  target: TargetState;
  predictedPosition: PredictedPosition;
  artillery: ArtilleryState;
  environment: EnvironmentalData;
  ballistic: BallisticSolution;
  /** GPS coordinates of SPH (dummy display) */
  gpsCoords: string;
  /** System uptime seconds */
  uptimeSeconds: number;
}
