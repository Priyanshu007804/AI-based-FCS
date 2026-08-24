const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type InterceptCoordinates = {
  x: number;
  y: number;
  z: number;
};

export type TrajectoryData = {
  status: string;
  target_id: string;
  time_of_flight: number;
  intercept_timestamp: number;
  intercept_coordinates: InterceptCoordinates;
  pan_angle_deg: number;
  tilt_angle_deg: number;
  pan_angle_rad: number;
  tilt_angle_rad: number;
};

export type FrameTelemetry = {
  frame: number;
  timestamp: number;
  detected: boolean;
  confidence: number;
  current_x: number;
  current_y: number;
  velocity_x: number;
  velocity_y: number;
  trajectory: TrajectoryData | null;
  canvas_point: { x: number; y: number };
};

export type VideoAnalysisResult = {
  status: string;
  video_id: string;
  original_filename: string;
  processed_video_url: string;
  duration_sec: number;
  fps: number;
  total_frames: number;
  detected_frames: number;
  summary: {
    max_velocity_m_s: number;
    avg_velocity_m_s: number;
    latest_intercept: TrajectoryData | null;
  };
  canvas_path: Array<{ x: number; y: number }>;
  frames: FrameTelemetry[];
};

export type SystemStatus = {
  status: string;
  pipeline_active: boolean;
  last_update_seconds_ago: number | null;
  total_telemetry_received: number;
};

/**
 * Uploads a pre-recorded video file to FastAPI backend for YOLOv8 object tracking
 * and projectile kinematic trajectory analysis.
 */
export async function uploadAndAnalyzeVideo(
  file: File,
  launchVelocity = 5.0
): Promise<VideoAnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE_URL}/analyze-video?launch_velocity=${launchVelocity}`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to process video on backend: ${errorText}`);
  }

  return response.json();
}

/**
 * Checks FastAPI backend health status and response latency.
 */
export async function fetchSystemStatus(): Promise<{
  status: SystemStatus;
  latencyMs: number;
}> {
  const start = performance.now();
  const response = await fetch(`${API_BASE_URL}/system-status`);
  const elapsed = performance.now() - start;

  if (!response.ok) {
    throw new Error(`Backend health check failed: ${response.statusText}`);
  }

  const data = await response.json();
  return { status: data, latencyMs: elapsed };
}
