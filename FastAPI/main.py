import math
import os
import subprocess
import time
import uuid
from typing import Dict, Optional, Any, List
import numpy as np
import cv2
from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Lazy load YOLO to avoid startup bottleneck if model needs downloading
_yolo_model = None

def get_yolo_model():
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO
        _yolo_model = YOLO("yolov8n.pt")
    return _yolo_model


# Create storage directories
os.makedirs("uploads", exist_ok=True)
os.makedirs("static", exist_ok=True)


# -----------------------------------------------------------------------------
# Pydantic Data Models (Civilian Terminology)
# -----------------------------------------------------------------------------

class CarTargetState(BaseModel):
    """Payload representing real-time telemetry from computer vision client."""
    car_id: str = Field(..., description="Unique identification tag for the tracked toy car")
    current_x: float = Field(..., description="Current X coordinate of the car in meters relative to origin")
    current_y: float = Field(..., description="Current Y coordinate of the car in meters relative to origin")
    current_z: float = Field(default=0.0, description="Current Z coordinate (ground plane height) in meters")
    velocity_x: float = Field(..., description="Car velocity along X axis in meters per second")
    velocity_y: float = Field(default=0.0, description="Car velocity along Y axis in meters per second")
    timestamp: float = Field(..., description="UNIX timestamp of the frame detection")


class InterceptCoordinates(BaseModel):
    """Predicted spatial coordinates for toy apple interception."""
    x: float = Field(..., description="Predicted X intercept position in meters")
    y: float = Field(..., description="Predicted Y intercept position in meters")
    z: float = Field(..., description="Predicted Z intercept position in meters")


class InterceptCalculationResponse(BaseModel):
    """Calculated pan/tilt angles and parameters for apple launcher mechanism."""
    status: str = Field(..., description="Calculation status: 'intercept_found' or 'target_out_of_reach'")
    target_id: str = Field(..., description="ID of the tracked car")
    time_of_flight: float = Field(..., description="Calculated apple flight time in seconds")
    intercept_timestamp: float = Field(..., description="Absolute UNIX timestamp when interception occurs")
    intercept_coordinates: InterceptCoordinates
    pan_angle_deg: float = Field(..., description="Horizontal launcher angle in degrees")
    tilt_angle_deg: float = Field(..., description="Vertical elevation launcher angle in degrees")
    pan_angle_rad: float = Field(..., description="Horizontal launcher angle in radians")
    tilt_angle_rad: float = Field(..., description="Vertical elevation launcher angle in radians")
    ballistic_simulation: Dict[str, Any] = Field(..., description="Physics parameters used for calculation")


class SystemStatusResponse(BaseModel):
    """Health check and pipeline operational telemetry response."""
    status: str = Field(..., description="Overall backend health status")
    pipeline_active: bool = Field(..., description="True if vision telemetry has been received recently")
    last_update_seconds_ago: Optional[float] = Field(None, description="Elapsed seconds since last vision update")
    total_telemetry_received: int = Field(..., description="Total count of target updates received")
    active_target: Optional[CarTargetState] = Field(None, description="Latest active car state telemetry")


# -----------------------------------------------------------------------------
# Global In-Memory Target State Store
# -----------------------------------------------------------------------------

class TelemetryStore:
    def __init__(self):
        self.latest_state: Optional[CarTargetState] = None
        self.total_updates: int = 0
        self.last_receive_time: Optional[float] = None

    def update(self, state: CarTargetState):
        self.latest_state = state
        self.total_updates += 1
        self.last_receive_time = time.time()

    def get_status(self) -> Dict[str, Any]:
        now = time.time()
        elapsed = (now - self.last_receive_time) if self.last_receive_time else None
        pipeline_active = elapsed is not None and elapsed < 5.0
        return {
            "status": "healthy",
            "pipeline_active": pipeline_active,
            "last_update_seconds_ago": round(elapsed, 3) if elapsed else None,
            "total_telemetry_received": self.total_updates,
            "active_target": self.latest_state
        }


target_store = TelemetryStore()


# -----------------------------------------------------------------------------
# Kinematic Physics Calculation Function
# -----------------------------------------------------------------------------

def calculate_interception_trajectory(
    target: CarTargetState,
    launch_velocity: float = 5.0,
    gravity: float = 9.81,
    launcher_x: float = 0.0,
    launcher_y: float = 0.0,
    launcher_z: float = 0.0
) -> Dict[str, Any]:
    """
    Computes the optimal projectile launch angles (Pan and Tilt) and Time of Flight (ToF)
    to intercept a moving target car assuming constant linear velocity.
    """
    dx_0 = target.current_x - launcher_x
    dy_0 = target.current_y - launcher_y
    dz_0 = target.current_z - launcher_z

    vx = target.velocity_x
    vy = target.velocity_y

    A = 0.25 * (gravity ** 2)
    B = 0.0
    C = (gravity * dz_0) + (vx ** 2) + (vy ** 2) - (launch_velocity ** 2)
    D = 2.0 * (dx_0 * vx + dy_0 * vy)
    E = (dx_0 ** 2) + (dy_0 ** 2) + (dz_0 ** 2)

    polynomial_coefficients = [A, B, C, D, E]
    all_roots = np.roots(polynomial_coefficients)

    valid_tofs: List[float] = []
    for r in all_roots:
        if np.isreal(r) or abs(np.imag(r)) < 1e-6:
            real_val = float(np.real(r))
            if real_val > 1e-4:
                valid_tofs.append(real_val)

    if not valid_tofs:
        return {
            "status": "target_out_of_reach",
            "target_id": target.car_id,
            "time_of_flight": 0.0,
            "intercept_timestamp": target.timestamp,
            "intercept_coordinates": InterceptCoordinates(x=target.current_x, y=target.current_y, z=target.current_z),
            "pan_angle_deg": 0.0,
            "tilt_angle_deg": 0.0,
            "pan_angle_rad": 0.0,
            "tilt_angle_rad": 0.0,
            "ballistic_simulation": {
                "launch_velocity": launch_velocity,
                "gravity": gravity,
                "launcher_origin": [launcher_x, launcher_y, launcher_z],
                "quartic_coefficients": [float(c) for c in polynomial_coefficients],
                "error": "No valid positive time of flight root. Target velocity or distance exceeds projectile range."
            }
        }

    tof = min(valid_tofs)

    x_intercept = target.current_x + vx * tof
    y_intercept = target.current_y + vy * tof
    z_intercept = target.current_z

    dx_i = x_intercept - launcher_x
    dy_i = y_intercept - launcher_y
    dz_i = z_intercept - launcher_z

    pan_rad = math.atan2(dy_i, dx_i)
    pan_deg = math.degrees(pan_rad)

    sin_phi = (dz_i + 0.5 * (gravity * (tof ** 2))) / (launch_velocity * tof)
    sin_phi_clamped = max(-1.0, min(1.0, sin_phi))
    tilt_rad = math.asin(sin_phi_clamped)
    tilt_deg = math.degrees(tilt_rad)

    intercept_time = target.timestamp + tof

    return {
        "status": "intercept_found",
        "target_id": target.car_id,
        "time_of_flight": round(tof, 4),
        "intercept_timestamp": round(intercept_time, 4),
        "intercept_coordinates": InterceptCoordinates(
            x=round(x_intercept, 4),
            y=round(y_intercept, 4),
            z=round(z_intercept, 4)
        ),
        "pan_angle_deg": round(pan_deg, 2),
        "tilt_angle_deg": round(tilt_deg, 2),
        "pan_angle_rad": round(pan_rad, 4),
        "tilt_angle_rad": round(tilt_rad, 4),
        "ballistic_simulation": {
            "launch_velocity_m_s": launch_velocity,
            "gravity_m_s2": gravity,
            "launcher_origin_meters": [launcher_x, launcher_y, launcher_z],
            "solution_roots_count": len(valid_tofs),
            "all_positive_tofs": [round(t, 4) for t in sorted(valid_tofs)]
        }
    }


# -----------------------------------------------------------------------------
# FastAPI Web Application & Routes
# -----------------------------------------------------------------------------

app = FastAPI(
    title="Civilian Automated Target Interception System",
    description="FastAPI backend providing real-time computer vision telemetry processing "
                "and projectile kinematic angle calculation for toy apple launcher.",
    version="1.0.0"
)

# Enable CORS for Next.js dashboard integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated/annotated videos as static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.post("/update-target-state", response_model=Dict[str, Any])
async def update_target_state(state: CarTargetState):
    """Receives real-time telemetry from computer vision client."""
    target_store.update(state)
    return {
        "status": "acknowledged",
        "car_id": state.car_id,
        "received_timestamp": state.timestamp,
        "server_time": time.time()
    }


@app.get("/calculate-intercept", response_model=InterceptCalculationResponse)
async def calculate_intercept(
    launch_velocity: float = Query(5.0, description="Fixed launch velocity of toy apple in m/s", ge=0.5, le=50.0),
    gravity: float = Query(9.81, description="Standard acceleration due to gravity in m/s^2", ge=1.0, le=20.0),
    launcher_x: float = Query(0.0, description="X offset of launcher origin in meters"),
    launcher_y: float = Query(0.0, description="Y offset of launcher origin in meters"),
    launcher_z: float = Query(0.0, description="Z offset (height) of launcher origin in meters")
):
    """Computes ToF and Pan/Tilt angles for launcher using latest target telemetry."""
    latest = target_store.latest_state
    if not latest:
        raise HTTPException(
            status_code=400,
            detail="No target telemetry available. Please stream target state or upload a video first."
        )

    result = calculate_interception_trajectory(
        target=latest,
        launch_velocity=launch_velocity,
        gravity=gravity,
        launcher_x=launcher_x,
        launcher_y=launcher_y,
        launcher_z=launcher_z
    )

    return InterceptCalculationResponse(**result)


@app.post("/analyze-video", response_model=Dict[str, Any])
async def analyze_video(
    file: UploadFile = File(...),
    launch_velocity: float = Query(5.0, description="Fixed launch velocity of projectile in m/s", ge=0.5, le=50.0),
    meters_per_pixel: float = Query(0.005, description="Pixel to meter calibration factor", ge=0.0001, le=0.1)
):
    """
    Accepts a pre-recorded video file upload, runs YOLOv8 multi-object tracking (model.track),
    locks onto a single persistent target ID across multi-car environments, calculates real-time
    velocity & kinematic interception trajectory, and returns full frame telemetry + URL for annotated video.
    """
    # 1. Save uploaded file to disk
    file_id = str(uuid.uuid4())[:8]
    ext = os.path.splitext(file.filename)[1] if file.filename else ".mp4"
    if not ext:
        ext = ".mp4"
    upload_path = os.path.join("uploads", f"input_{file_id}{ext}")
    processed_filename = f"processed_{file_id}.mp4"
    processed_path = os.path.join("static", processed_filename)

    with open(upload_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # 2. Open video with OpenCV
    cap = cv2.VideoCapture(upload_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Could not open uploaded video file.")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 0 or math.isnan(fps):
        fps = 30.0

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    # 3. Setup VideoWriter
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(processed_path, fourcc, fps, (width, height))

    # 4. Load YOLO model
    model = get_yolo_model()

    # COCO Vehicle Class IDs: 2 = car, 5 = bus, 7 = truck, 3 = motorcycle
    VEHICLE_CLASS_IDS = [2, 3, 5, 7]
    VELOCITY_EMA_ALPHA = 0.35
    REACQUIRE_DISTANCE_PX = 80  # Max pixel distance to re-identify a lost target
    TARGET_TIMEOUT_FRAMES = 30  # Frames before a lost target is dropped from memory

    # -------------------------------------------------------------------------
    # Multi-Target State Store (inspired by DeepSORT state management)
    # Each target gets its own velocity history and predicted position.
    # -------------------------------------------------------------------------
    class TrackedTarget:
        """Per-target state tracker with EMA velocity smoothing and occlusion prediction."""
        def __init__(self, track_id: int, cx: float, cy: float, frame_num: int):
            self.track_id = track_id
            self.cx = cx  # center X in pixels
            self.cy = cy  # center Y in pixels
            self.prev_cx = cx
            self.prev_cy = cy
            self.smooth_vx_px = 0.0  # smoothed velocity in pixels/frame
            self.smooth_vy_px = 0.0
            self.first_detection = True
            self.last_seen_frame = frame_num
            self.frames_tracked = 0
            self.color = self._assign_color(track_id)

        @staticmethod
        def _assign_color(tid: int):
            """Deterministic color per target ID for visual distinction."""
            palette = [
                (0, 255, 0),    # green
                (255, 100, 0),  # blue-orange
                (0, 200, 255),  # yellow
                (255, 0, 128),  # pink
                (128, 255, 0),  # lime
                (0, 128, 255),  # orange
                (255, 255, 0),  # cyan
                (200, 0, 255),  # purple
            ]
            return palette[tid % len(palette)]

        def update(self, cx: float, cy: float, frame_num: int):
            """Update position and compute smoothed pixel velocity."""
            self.prev_cx = self.cx
            self.prev_cy = self.cy
            self.cx = cx
            self.cy = cy
            self.last_seen_frame = frame_num
            self.frames_tracked += 1

            if not self.first_detection:
                raw_vx = cx - self.prev_cx
                raw_vy = cy - self.prev_cy
                self.smooth_vx_px = VELOCITY_EMA_ALPHA * raw_vx + (1 - VELOCITY_EMA_ALPHA) * self.smooth_vx_px
                self.smooth_vy_px = VELOCITY_EMA_ALPHA * raw_vy + (1 - VELOCITY_EMA_ALPHA) * self.smooth_vy_px
            else:
                self.first_detection = False

        def predicted_position(self, frames_ahead: float) -> tuple:
            """Predict future pixel position using constant velocity model."""
            pred_cx = self.cx + self.smooth_vx_px * frames_ahead
            pred_cy = self.cy + self.smooth_vy_px * frames_ahead
            return pred_cx, pred_cy

        def kalman_predicted_now(self, current_frame: int) -> tuple:
            """Where the target SHOULD be now based on last known velocity (for re-acquisition)."""
            dt = current_frame - self.last_seen_frame
            return self.cx + self.smooth_vx_px * dt, self.cy + self.smooth_vy_px * dt

    # Active target registry: yolo_track_id -> TrackedTarget
    active_targets: Dict[int, TrackedTarget] = {}
    # Lost targets (went behind occlusion): list of TrackedTarget
    lost_targets: List[TrackedTarget] = []

    frame_telemetry: List[Dict[str, Any]] = []
    canvas_path: List[Dict[str, float]] = []

    max_vel = 0.0
    sum_vel = 0.0
    detected_frames = 0
    frame_idx = 0
    primary_target_id: Optional[int] = None

    latest_intercept_result: Optional[Dict[str, Any]] = None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_idx += 1
        current_time_sec = frame_idx / fps

        # ----- YOLOv8 Multi-Object Tracking -----
        results = model.track(frame, persist=True, classes=VEHICLE_CLASS_IDS, verbose=False)[0]

        # Gather all current detections: {yolo_track_id: (cx, cy, x1, y1, x2, y2, conf)}
        current_detections: Dict[int, tuple] = {}
        if results.boxes is not None and results.boxes.id is not None:
            track_ids = results.boxes.id.int().cpu().tolist()
            for i, tid in enumerate(track_ids):
                box = results.boxes[i]
                xyxy = box.xyxy[0].cpu().numpy()
                x1, y1, x2, y2 = map(int, xyxy)
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0
                conf = float(box.conf[0].item())
                current_detections[tid] = (cx, cy, x1, y1, x2, y2, conf)

        # ----- Step A: Update existing active targets -----
        seen_yolo_ids = set()
        for tid, det in current_detections.items():
            cx, cy, x1, y1, x2, y2, conf = det
            if tid in active_targets:
                # Known target — update its state
                active_targets[tid].update(cx, cy, frame_idx)
                seen_yolo_ids.add(tid)
            else:
                # New YOLO ID — check if it's a re-acquired lost target
                reacquired = False
                best_dist = REACQUIRE_DISTANCE_PX
                best_lost_idx = -1

                for li, lt in enumerate(lost_targets):
                    pred_cx, pred_cy = lt.kalman_predicted_now(frame_idx)
                    dist = math.hypot(cx - pred_cx, cy - pred_cy)
                    if dist < best_dist:
                        best_dist = dist
                        best_lost_idx = li

                if best_lost_idx >= 0:
                    # Re-acquire! Transfer state from lost target to new YOLO ID
                    recovered = lost_targets.pop(best_lost_idx)
                    recovered.track_id = tid
                    recovered.update(cx, cy, frame_idx)
                    active_targets[tid] = recovered
                    print(f"[RE-ACQUIRE] Lost target recovered as new YOLO ID #{tid} (dist={best_dist:.1f}px)")
                else:
                    # Genuinely new target
                    active_targets[tid] = TrackedTarget(tid, cx, cy, frame_idx)
                    print(f"[NEW TARGET] Vehicle #{tid} acquired at ({cx:.0f}, {cy:.0f})")

                seen_yolo_ids.add(tid)

        # ----- Step B: Move unseen active targets to lost list -----
        newly_lost = []
        for tid in list(active_targets.keys()):
            if tid not in seen_yolo_ids:
                target = active_targets[tid]
                if frame_idx - target.last_seen_frame > 2:
                    # Lost for more than 2 frames — move to lost pool
                    newly_lost.append(tid)

        for tid in newly_lost:
            lost_target = active_targets.pop(tid)
            lost_targets.append(lost_target)
            print(f"[LOST] Target #{tid} lost (last seen frame {lost_target.last_seen_frame})")

        # ----- Step C: Purge stale lost targets -----
        lost_targets = [lt for lt in lost_targets if (frame_idx - lt.last_seen_frame) < TARGET_TIMEOUT_FRAMES]

        # ----- Step D: Set primary target (first detected, for API response) -----
        if primary_target_id is None and len(active_targets) > 0:
            primary_target_id = next(iter(active_targets))

        # ----- Step E: Draw ALL active targets with predicted X marks -----
        frame_info: Dict[str, Any] = {
            "frame": frame_idx,
            "timestamp": round(current_time_sec, 3),
            "detected": False,
            "confidence": 0.0,
            "current_x": 0.0,
            "current_y": 0.0,
            "velocity_x": 0.0,
            "velocity_y": 0.0,
            "trajectory": None,
            "canvas_point": {"x": 0.5, "y": 0.5},
            "targets_count": len(active_targets)
        }

        for tid, tgt in active_targets.items():
            if tid not in current_detections:
                continue  # Skip targets not visible this frame

            cx, cy, x1, y1, x2, y2, conf = current_detections[tid]
            detected_frames += 1

            current_x_m = cx * meters_per_pixel
            current_y_m = cy * meters_per_pixel
            vx_m_s = tgt.smooth_vx_px * fps * meters_per_pixel
            vy_m_s = tgt.smooth_vy_px * fps * meters_per_pixel

            current_speed = math.hypot(vx_m_s, vy_m_s)
            sum_vel += current_speed
            max_vel = max(max_vel, current_speed)

            # Kinematic intercept calculation
            state = CarTargetState(
                car_id=f"target_{tid}",
                current_x=round(current_x_m, 4),
                current_y=round(current_y_m, 4),
                current_z=0.0,
                velocity_x=round(vx_m_s, 4),
                velocity_y=round(vy_m_s, 4),
                timestamp=round(current_time_sec, 4)
            )

            intercept = calculate_interception_trajectory(target=state, launch_velocity=launch_velocity)
            tof = intercept["time_of_flight"] if intercept["status"] == "intercept_found" else 1.5

            # Predicted future position (in pixels)
            frames_ahead = tof * fps
            pred_cx, pred_cy = tgt.predicted_position(frames_ahead)
            pred_x_px = max(20, min(width - 20, int(pred_cx)))
            pred_y_px = max(20, min(height - 20, int(pred_cy)))

            cx_int, cy_int = int(cx), int(cy)
            color = tgt.color

            # Update primary target info for API response
            if tid == primary_target_id:
                target_store.update(state)
                latest_intercept_result = intercept
                norm_x = min(0.95, max(0.05, cx / float(width)))
                norm_y = min(0.95, max(0.05, cy / float(height)))
                canvas_path.append({"x": round(norm_x, 4), "y": round(norm_y, 4)})
                frame_info.update({
                    "detected": True,
                    "confidence": round(conf, 2),
                    "current_x": round(current_x_m, 4),
                    "current_y": round(current_y_m, 4),
                    "velocity_x": round(vx_m_s, 4),
                    "velocity_y": round(vy_m_s, 4),
                    "trajectory": intercept,
                    "canvas_point": {"x": round(norm_x, 4), "y": round(norm_y, 4)}
                })

            # ===== DRAW: Bounding Box with corner brackets =====
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            blen = min(14, int((x2 - x1) * 0.2))
            for corner_x, corner_y, dx, dy in [
                (x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1)
            ]:
                cv2.line(frame, (corner_x, corner_y), (corner_x + dx * blen, corner_y), (0, 255, 255), 2)
                cv2.line(frame, (corner_x, corner_y), (corner_x, corner_y + dy * blen), (0, 255, 255), 2)

            # Center dot
            cv2.circle(frame, (cx_int, cy_int), 4, (0, 0, 255), -1)

            # ===== DRAW: Lead line from target to predicted X =====
            cv2.line(frame, (cx_int, cy_int), (pred_x_px, pred_y_px), (0, 165, 255), 2, cv2.LINE_AA)

            # ===== DRAW: Predicted "X" mark =====
            arm = 13
            cv2.line(frame, (pred_x_px - arm, pred_y_px - arm), (pred_x_px + arm, pred_y_px + arm), (0, 0, 255), 3, cv2.LINE_AA)
            cv2.line(frame, (pred_x_px + arm, pred_y_px - arm), (pred_x_px - arm, pred_y_px + arm), (0, 0, 255), 3, cv2.LINE_AA)
            cv2.line(frame, (pred_x_px - arm, pred_y_px - arm), (pred_x_px + arm, pred_y_px + arm), (0, 255, 255), 1, cv2.LINE_AA)
            cv2.line(frame, (pred_x_px + arm, pred_y_px - arm), (pred_x_px - arm, pred_y_px + arm), (0, 255, 255), 1, cv2.LINE_AA)

            # Reticle + blast radius
            cv2.circle(frame, (pred_x_px, pred_y_px), 20, (0, 165, 255), 2, cv2.LINE_AA)
            cv2.circle(frame, (pred_x_px, pred_y_px), 38, (0, 255, 255), 1, cv2.LINE_AA)

            # Predicted label
            cv2.putText(frame, f"PRED (X) ToF:{tof:.1f}s",
                        (pred_x_px - 55, max(18, pred_y_px - 25)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 215, 255), 1, cv2.LINE_AA)

            # HUD per target
            spd_str = f"{current_speed:.1f}m/s"
            cv2.putText(frame, f"[TGT #{tid}] {conf:.2f} | {spd_str}",
                        (x1, max(25, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 2)

        # ----- Step F: Draw ghost predictions for LOST targets (Kalman prediction through occlusion) -----
        for lt in lost_targets:
            ghost_cx, ghost_cy = lt.kalman_predicted_now(frame_idx)
            gx, gy = int(ghost_cx), int(ghost_cy)
            if 10 < gx < width - 10 and 10 < gy < height - 10:
                # Dashed circle for ghost prediction
                cv2.circle(frame, (gx, gy), 18, (100, 100, 100), 1, cv2.LINE_AA)
                cv2.putText(frame, f"[LOST #{lt.track_id}]", (gx - 30, gy - 22),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, (120, 120, 120), 1)

        frame_telemetry.append(frame_info)

        # Global HUD banner
        active_count = len(active_targets)
        lost_count = len(lost_targets)
        cv2.putText(frame, f"FCS HUNTER-KILLER | Frame {frame_idx}/{total_frames} | Active: {active_count} | Lost: {lost_count} | Primary: #{primary_target_id}",
                    (12, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 2)

        out.write(frame)

    cap.release()
    out.release()

    # Convert output MP4 to H.264 (AVC1) using ffmpeg for native HTML5 browser playback
    web_processed_filename = f"web_{processed_filename}"
    web_processed_path = os.path.join("static", web_processed_filename)

    try:
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", processed_path,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "fast",
            web_processed_path
        ]
        subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        final_video_filename = web_processed_filename
    except Exception as e:
        print(f"[!] Warning: ffmpeg H.264 conversion failed ({e}). Returning raw video.")
        final_video_filename = processed_filename

    avg_vel = (sum_vel / detected_frames) if detected_frames > 0 else 0.0

    return {
        "status": "success",
        "video_id": file_id,
        "original_filename": file.filename,
        "processed_video_url": f"http://localhost:8000/static/{final_video_filename}",
        "duration_sec": round(frame_idx / fps, 2),
        "fps": round(fps, 1),
        "total_frames": frame_idx,
        "detected_frames": detected_frames,
        "summary": {
            "max_velocity_m_s": round(max_vel, 2),
            "avg_velocity_m_s": round(avg_vel, 2),
            "latest_intercept": latest_intercept_result
        },
        "canvas_path": canvas_path if len(canvas_path) > 0 else [{"x": 0.1, "y": 0.82}, {"x": 0.78, "y": 0.28}],
        "frames": frame_telemetry
    }


@app.get("/system-status", response_model=SystemStatusResponse)
async def system_status():
    """Returns system pipeline health check and telemetry status."""
    return SystemStatusResponse(**target_store.get_status())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
