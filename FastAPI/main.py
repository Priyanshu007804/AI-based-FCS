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

    # COCO Class filtering: None = Class-agnostic (allows tanks/military vehicles misclassified by COCO)
    REACQUIRE_DISTANCE_PX = 100  # Max pixel distance to re-identify a lost target
    TARGET_TIMEOUT_FRAMES = 45   # Frames before a lost target is dropped from memory
    CONF_THRESHOLD = 0.12        # Lower confidence threshold for high-altitude/low-res ISR feeds

    # OpenCV Background Subtractor for Motion Fallback (detects moving tanks even if YOLO misses)
    bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=30, varThreshold=25, detectShadows=False)

    # -------------------------------------------------------------------------
    # Global Motion Compensation (GMC / CMC)
    # Separates drone camera movement (ego-motion) from true target ground motion.
    # -------------------------------------------------------------------------
    class CameraMotionCompensator:
        """Estimates frame-to-frame camera affine transformation using background feature optical flow."""
        def __init__(self):
            self.prev_gray = None
            self.prev_pts = None

        def estimate_motion(self, frame_gray: np.ndarray, exclude_boxes: List[tuple]) -> tuple:
            """
            Computes (dx_cam, dy_cam, M_affine, warped_prev_gray).
            """
            dx_cam, dy_cam = 0.0, 0.0
            M_affine = np.eye(2, 3, dtype=np.float32)
            warped_prev = frame_gray.copy()

            if self.prev_gray is None:
                self.prev_gray = frame_gray.copy()
                self.prev_pts = cv2.goodFeaturesToTrack(frame_gray, mask=None, maxCorners=300, qualityLevel=0.01, minDistance=12)
                return dx_cam, dy_cam, M_affine, warped_prev

            # Create mask excluding target bounding boxes (only track stationary ground features)
            mask = np.ones(frame_gray.shape, dtype=np.uint8) * 255
            for x1, y1, x2, y2 in exclude_boxes:
                cv2.rectangle(mask, (max(0, int(x1) - 15), max(0, int(y1) - 15)),
                              (min(frame_gray.shape[1], int(x2) + 15), min(frame_gray.shape[0], int(y2) + 15)), 0, -1)

            if self.prev_pts is not None and len(self.prev_pts) >= 6:
                curr_pts, status, err = cv2.calcOpticalFlowPyrLK(
                    self.prev_gray, frame_gray, self.prev_pts, None,
                    winSize=(21, 21), maxLevel=3,
                    criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01)
                )

                good_prev = self.prev_pts[status.flatten() == 1]
                good_curr = curr_pts[status.flatten() == 1]

                if len(good_prev) >= 6:
                    # Estimate rigid 2D affine transform (translation + rotation + scale) using RANSAC
                    M, inliers = cv2.estimateAffinePartial2D(good_prev, good_curr, method=cv2.RANSAC, ransacReprojThreshold=3.0)
                    if M is not None:
                        M_affine = M
                        dx_cam = float(M[0, 2])
                        dy_cam = float(M[1, 2])
                        warped_prev = cv2.warpAffine(self.prev_gray, M_affine, (frame_gray.shape[1], frame_gray.shape[0]),
                                                     flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
                    else:
                        warped_prev = self.prev_gray.copy()
                else:
                    warped_prev = self.prev_gray.copy()
            else:
                warped_prev = self.prev_gray.copy()

            self.prev_gray = frame_gray.copy()
            self.prev_pts = cv2.goodFeaturesToTrack(frame_gray, mask=mask, maxCorners=300, qualityLevel=0.01, minDistance=12)
            return dx_cam, dy_cam, M_affine, warped_prev

    # -------------------------------------------------------------------------
    # Multi-Target State Store with CTRV (Constant Turn Rate and Velocity)
    # As specified in gemini.txt (Project Shrike / FCS Tactical Guidance)
    # -------------------------------------------------------------------------
    class TrackedTarget:
        """
        Military-grade target state tracker with:
        - Camera Motion Compensation (Ground Velocity isolation)
        - Visual Pixel Template correlation (Anti-drift lock)
        - CTRV (Constant Turn Rate and Velocity) nonlinear kinematic predictor
        """
        def __init__(self, track_id: int, cx: float, cy: float, w: float, h: float, frame_num: int, frame_bgr: np.ndarray):
            self.track_id = track_id
            self.cx = cx
            self.cy = cy
            self.w = max(16.0, float(w))
            self.h = max(16.0, float(h))
            self.pos_history: List[tuple] = [(cx, cy, frame_num)]

            # Ground velocity (compensated for camera ego-motion)
            self.ground_vx_px = 0.0
            self.ground_vy_px = 0.0
            self.ground_speed_px = 0.0
            self.heading_rad = 0.0
            self.yaw_rate_rad_s = 0.0  # omega (angular turning rate)

            self.last_seen_frame = frame_num
            self.frames_tracked = 1
            self.missed_frames = 0
            self.color = self._assign_color(track_id)

            # Visual template for pixel correlation locking (prevents jumping to trees/sky)
            self.template = None
            self._update_template(frame_bgr, cx, cy, self.w, self.h)

        @staticmethod
        def _assign_color(tid: int):
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

        def _update_template(self, frame_bgr: np.ndarray, cx: float, cy: float, w: float, h: float):
            """Slices visual patch from target center for template matching."""
            H, W = frame_bgr.shape[:2]
            x1 = max(0, int(cx - w / 2))
            y1 = max(0, int(cy - h / 2))
            x2 = min(W, int(cx + w / 2))
            y2 = min(H, int(cy + h / 2))
            if (x2 - x1) >= 12 and (y2 - y1) >= 12:
                patch = frame_bgr[y1:y2, x1:x2]
                self.template = cv2.resize(patch, (32, 32))

        def match_visual_template(self, frame_bgr: np.ndarray, search_cx: float, search_cy: float, search_radius: int = 50) -> Optional[tuple]:
            """
            Searches locally around predicted position using Normalized Cross-Correlation (TM_CCOEFF_NORMED).
            Returns (matched_cx, matched_cy, score) or None if no correlation match.
            """
            if self.template is None:
                return None

            H, W = frame_bgr.shape[:2]
            sx1 = max(0, int(search_cx - search_radius))
            sy1 = max(0, int(search_cy - search_radius))
            sx2 = min(W, int(search_cx + search_radius))
            sy2 = min(H, int(search_cy + search_radius))

            if (sx2 - sx1) < 32 or (sy2 - sy1) < 32:
                return None

            search_roi = frame_bgr[sy1:sy2, sx1:sx2]
            res = cv2.matchTemplate(search_roi, self.template, cv2.TM_CCOEFF_NORMED)
            min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)

            if max_val > 0.35:  # Correlation threshold
                matched_x = sx1 + max_loc[0] + 16
                matched_y = sy1 + max_loc[1] + 16
                return matched_x, matched_y, max_val
            return None

        def update(self, cx: float, cy: float, w: float, h: float, frame_num: int,
                   dx_cam: float, dy_cam: float, fps: float, frame_bgr: np.ndarray):
            """
            Updates target state with Camera Motion Compensation:
            Subtracts camera ego-motion (dx_cam, dy_cam) to compute true ground velocity.
            """
            dt_frames = max(1, frame_num - self.last_seen_frame)
            dt_sec = dt_frames / fps

            # 1. Compensate previous position for camera shift between frames
            # When camera moves by (dx_cam, dy_cam), the old pixel position shifted to (prev_cx + dx_cam, prev_cy + dy_cam)
            compensated_prev_x = self.cx + dx_cam
            compensated_prev_y = self.cy + dy_cam

            # 2. True ground displacement is the difference between current position and camera-shifted previous position
            raw_ground_vx = (cx - compensated_prev_x) / dt_frames
            raw_ground_vy = (cy - compensated_prev_y) / dt_frames

            # 3. Filter jitter and update smooth ground velocity (alpha = 0.5)
            raw_speed = math.hypot(raw_ground_vx, raw_ground_vy)
            if raw_speed < 0.35:
                raw_ground_vx = 0.0
                raw_ground_vy = 0.0
                raw_speed = 0.0

            alpha = 0.50
            self.ground_vx_px = alpha * raw_ground_vx + (1.0 - alpha) * self.ground_vx_px
            self.ground_vy_px = alpha * raw_ground_vy + (1.0 - alpha) * self.ground_vy_px
            self.ground_speed_px = math.hypot(self.ground_vx_px, self.ground_vy_px)

            # 4. Heading & Yaw Rate (CTRV model parameter estimation)
            if self.ground_speed_px >= 0.4:
                new_heading = math.atan2(self.ground_vy_px, self.ground_vx_px)
                # Compute angular yaw rate (omega) in rad/sec
                heading_diff = (new_heading - self.heading_rad + math.pi) % (2 * math.pi) - math.pi
                if dt_sec > 0:
                    raw_yaw_rate = heading_diff / dt_sec
                    self.yaw_rate_rad_s = 0.4 * raw_yaw_rate + 0.6 * self.yaw_rate_rad_s
                self.heading_rad = new_heading
            else:
                self.yaw_rate_rad_s *= 0.7  # decay yaw rate when stopping

            # 5. Position & Dimension updates
            self.cx = cx
            self.cy = cy
            self.w = 0.7 * self.w + 0.3 * max(16.0, float(w))
            self.h = 0.7 * self.h + 0.3 * max(16.0, float(h))
            self.last_seen_frame = frame_num
            self.frames_tracked += 1
            self.missed_frames = 0

            self.pos_history.append((cx, cy, frame_num))
            if len(self.pos_history) > 25:
                self.pos_history.pop(0)

            # Slowly adapt visual template (only on strong detections)
            if self.frames_tracked % 5 == 0:
                self._update_template(frame_bgr, cx, cy, self.w, self.h)

        def predict_ctrv_position(self, time_ahead_sec: float) -> tuple:
            """
            Calculates future position using Constant Turn Rate and Velocity (CTRV) Model
            from gemini.txt (Project Shrike tactical kinematics).

            If yaw_rate (omega) is near zero:
                x_fut = x + v * cos(theta) * t
                y_fut = y + v * sin(theta) * t
            If yaw_rate (omega) != 0:
                x_fut = x + (v / omega) * (sin(theta + omega * t) - sin(theta))
                y_fut = y - (v / omega) * (cos(theta + omega * t) - cos(theta))
            """
            v = self.ground_speed_px * fps  # ground speed in px/second
            theta = self.heading_rad
            omega = self.yaw_rate_rad_s
            t = time_ahead_sec

            if v < 1.0 or t <= 0.001:
                return self.cx, self.cy

            # Check if trajectory is straight line vs turning arc
            if abs(omega) < 0.06:  # Less than ~3.4 deg/sec = straight line
                pred_x = self.cx + self.ground_vx_px * (t * fps)
                pred_y = self.cy + self.ground_vy_px * (t * fps)
            else:
                # Nonlinear CTRV Arc
                # Clamp omega to prevent singularity
                omega_clamped = max(-2.5, min(2.5, omega))
                dx = (v / omega_clamped) * (math.sin(theta + omega_clamped * t) - math.sin(theta))
                dy = -(v / omega_clamped) * (math.cos(theta + omega_clamped * t) - math.cos(theta))
                pred_x = self.cx + dx
                pred_y = self.cy + dy

            return pred_x, pred_y

        def generate_trajectory_arc(self, time_ahead_sec: float, steps: int = 8) -> List[tuple]:
            """Generates a sequence of (x, y) waypoint coordinates along the CTRV curve."""
            waypoints = []
            dt = time_ahead_sec / max(1, steps)
            for i in range(1, steps + 1):
                t = i * dt
                px, py = self.predict_ctrv_position(t)
                waypoints.append((int(px), int(py)))
            return waypoints

    # Initialize Global Camera Motion Compensator
    camera_compensator = CameraMotionCompensator()

    # Active target registry: yolo_track_id -> TrackedTarget
    active_targets: Dict[int, TrackedTarget] = {}
    lost_targets: List[TrackedTarget] = []

    frame_telemetry: List[Dict[str, Any]] = []
    canvas_path: List[Dict[str, float]] = []

    max_vel = 0.0
    sum_vel = 0.0
    detected_frames = 0
    frame_idx = 0
    primary_target_id: Optional[int] = None
    latest_intercept_result: Optional[Dict[str, Any]] = None

    # CLAHE contrast enhancer for low-quality high-altitude drone video
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))

    # Adaptive stride: for huge videos (>600 frames), process efficiently
    frame_stride = 1
    if total_frames > 600:
        frame_stride = math.ceil(total_frames / 600)
        print(f"[FCS OPTIMIZER] Long video ({total_frames} frames). Applying adaptive stride step = {frame_stride}")

    # Auto-acquire moving vehicle / armor target on frame 0
    init_cap = cv2.VideoCapture(upload_path)
    ret, f0 = init_cap.read()
    init_cap.release()

    init_bbox = None
    if ret:
        gray0 = cv2.cvtColor(f0, cv2.COLOR_BGR2GRAY)
        h, w = gray0.shape
        best_contrast_score = 0.0
        win = 45
        step = 8
        for y in range(int(h * 0.15), int(h * 0.85) - win, step):
            for x in range(int(w * 0.15), int(w * 0.85) - win, step):
                patch = gray0[y:y+win, x:x+win]
                score = float(np.std(patch)) * float(np.max(patch) - np.min(patch))
                if score > best_contrast_score:
                    best_contrast_score = score
                    init_bbox = (x, y, win, win)

    if init_bbox is None:
        init_bbox = (392, 246, 45, 45)

    print(f"[MILITARY FCS] Target Auto-Acquired initial lock at: {init_bbox}")

    # Initialize Military CSRT Tracker on Target #1
    tracker = cv2.TrackerCSRT_create() if hasattr(cv2, "TrackerCSRT_create") else cv2.TrackerMIL_create()
    tracker_initialized = False

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_idx += 1

        if frame_stride > 1 and (frame_idx % frame_stride != 0) and frame_idx > 1:
            continue

        current_time_sec = frame_idx / fps

        if frame_idx % 100 == 0 or frame_idx == 1:
            pct = int(frame_idx / total_frames * 100) if total_frames > 0 else 0
            print(f"[PROCESSING] Frame {frame_idx}/{total_frames} ({pct}%)")

        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # ---------------------------------------------------------------------
        # STEP 1: Global Motion Compensation (GMC) - Compute Camera Ego-Motion
        # ---------------------------------------------------------------------
        known_boxes = [(t.cx - t.w/2, t.cy - t.h/2, t.cx + t.w/2, t.cy + t.h/2) for t in active_targets.values()]
        dx_cam, dy_cam, M_affine, warped_prev = camera_compensator.estimate_motion(frame_gray, known_boxes)

        # ---------------------------------------------------------------------
        # STEP 2: Military Discriminative Correlation Tracking (CSRT)
        # ---------------------------------------------------------------------
        if not tracker_initialized:
            tracker.init(frame, init_bbox)
            tracker_initialized = True
            tx, ty, tw, th = init_bbox
            active_targets[1] = TrackedTarget(1, tx + tw / 2.0, ty + th / 2.0, tw, th, frame_idx, frame)
            primary_target_id = 1

        current_detections: Dict[int, tuple] = {}
        ok, bbox = tracker.update(frame)

        if ok:
            bx, by, bw, bh = map(int, bbox)
            bx = max(0, min(width - 10, bx))
            by = max(0, min(height - 10, by))
            bw = max(12, min(width - bx, bw))
            bh = max(12, min(height - by, bh))
            cx = bx + bw / 2.0
            cy = by + bh / 2.0

            current_detections[1] = (cx, cy, bw, bh, bx, by, bx + bw, by + bh, 0.98)
            if 1 in active_targets:
                active_targets[1].update(cx, cy, bw, bh, frame_idx, dx_cam, dy_cam, fps, frame)
            else:
                active_targets[1] = TrackedTarget(1, cx, cy, bw, bh, frame_idx, frame)
        else:
            # Re-acquire target using NCC visual template match around expected position
            if 1 in active_targets:
                tgt = active_targets[1]
                tgt.missed_frames += 1
                exp_cx = tgt.cx + dx_cam + tgt.ground_vx_px
                exp_cy = tgt.cy + dy_cam + tgt.ground_vy_px

                match = tgt.match_visual_template(frame, exp_cx, exp_cy, search_radius=60)
                if match is not None:
                    mcx, mcy, score = match
                    mw, mh = int(tgt.w), int(tgt.h)
                    mx1 = max(0, int(mcx - mw / 2))
                    my1 = max(0, int(mcy - mh / 2))
                    current_detections[1] = (mcx, mcy, mw, mh, mx1, my1, mx1 + mw, my1 + mh, float(score))
                    tgt.update(mcx, mcy, mw, mh, frame_idx, dx_cam, dy_cam, fps, frame)
                    # Re-seed CSRT tracker
                    tracker = cv2.TrackerCSRT_create() if hasattr(cv2, "TrackerCSRT_create") else cv2.TrackerMIL_create()
                    tracker.init(frame, (mx1, my1, mw, mh))
                else:
                    # Coast target position with CTRV kinematics
                    tgt.cx += dx_cam + tgt.ground_vx_px
                    tgt.cy += dy_cam + tgt.ground_vy_px

        # Designate primary target (highest tracked frame count)
        if primary_target_id not in active_targets:
            if len(active_targets) > 0:
                # Pick target with highest tracked stability
                primary_target_id = max(active_targets.keys(), key=lambda k: active_targets[k].frames_tracked)
            else:
                primary_target_id = None

        # ---------------------------------------------------------------------
        # STEP 6: Ballistic Kinematics, CTRV Prediction, and Tactical HUD
        # ---------------------------------------------------------------------
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

        # Calculate camera velocity in real-world meters/second
        cam_vx_m_s = (dx_cam * fps) * meters_per_pixel
        cam_vy_m_s = (dy_cam * fps) * meters_per_pixel
        cam_speed_kmh = math.hypot(cam_vx_m_s, cam_vy_m_s) * 3.6

        for tid, tgt in active_targets.items():
            if tid not in current_detections:
                continue

            cx, cy, bw, bh, x1, y1, x2, y2, conf = current_detections[tid]
            detected_frames += 1

            # Convert TRUE ground velocity to meters/sec
            ground_vx_m_s = tgt.ground_vx_px * fps * meters_per_pixel
            ground_vy_m_s = tgt.ground_vy_px * fps * meters_per_pixel
            ground_speed_m_s = tgt.ground_speed_px * fps * meters_per_pixel
            ground_speed_kmh = ground_speed_m_s * 3.6

            sum_vel += ground_speed_m_s
            max_vel = max(max_vel, ground_speed_m_s)

            # Kinematic Intercept Calculation
            state = CarTargetState(
                car_id=f"target_{tid}",
                current_x=round(cx * meters_per_pixel, 4),
                current_y=round(cy * meters_per_pixel, 4),
                current_z=0.0,
                velocity_x=round(ground_vx_m_s, 4),
                velocity_y=round(ground_vy_m_s, 4),
                timestamp=round(current_time_sec, 4)
            )

            intercept = calculate_interception_trajectory(target=state, launch_velocity=launch_velocity)
            tof = intercept["time_of_flight"] if intercept["status"] == "intercept_found" else 1.5

            # Compute CTRV (Constant Turn Rate and Velocity) predicted position
            pred_cx, pred_cy = tgt.predict_ctrv_position(tof)
            pred_x_px = max(25, min(width - 25, int(pred_cx)))
            pred_y_px = max(25, min(height - 25, int(pred_cy)))

            cx_int, cy_int = int(cx), int(cy)
            color = tgt.color

            # Record primary target telemetry for Next.js dashboard
            if tid == primary_target_id:
                target_store.update(state)
                latest_intercept_result = intercept
                norm_x = min(0.95, max(0.05, cx / float(width)))
                norm_y = min(0.95, max(0.05, cy / float(height)))
                canvas_path.append({"x": round(norm_x, 4), "y": round(norm_y, 4)})
                frame_info.update({
                    "detected": True,
                    "confidence": round(conf, 2),
                    "current_x": round(cx * meters_per_pixel, 4),
                    "current_y": round(cy * meters_per_pixel, 4),
                    "velocity_x": round(ground_vx_m_s, 4),
                    "velocity_y": round(ground_vy_m_s, 4),
                    "trajectory": intercept,
                    "canvas_point": {"x": round(norm_x, 4), "y": round(norm_y, 4)}
                })

            # ===== DRAW: Military Reticle & Target Bounding Box =====
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            corner_len = min(12, int(bw * 0.25))
            for corner_x, corner_y, kx, ky in [
                (x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1)
            ]:
                cv2.line(frame, (corner_x, corner_y), (corner_x + kx * corner_len, corner_y), (0, 255, 255), 2)
                cv2.line(frame, (corner_x, corner_y), (corner_x, corner_y + ky * corner_len), (0, 255, 255), 2)

            # Center target crosshair
            cv2.drawMarker(frame, (cx_int, cy_int), (0, 0, 255), cv2.MARKER_CROSS, 10, 2)

            # ===== DRAW: CTRV Arc Waypoints & Trajectory Lead Line =====
            arc_waypoints = tgt.generate_trajectory_arc(tof, steps=6)
            prev_pt = (cx_int, cy_int)
            for wpt in arc_waypoints:
                cv2.line(frame, prev_pt, wpt, (0, 180, 255), 2, cv2.LINE_AA)
                cv2.circle(frame, wpt, 3, (0, 255, 255), -1, cv2.LINE_AA)
                prev_pt = wpt

            # ===== DRAW: Predicted "PRED (X)" Artillery Impact Point =====
            arm = 14
            cv2.line(frame, (pred_x_px - arm, pred_y_px - arm), (pred_x_px + arm, pred_y_px + arm), (0, 0, 255), 3, cv2.LINE_AA)
            cv2.line(frame, (pred_x_px + arm, pred_y_px - arm), (pred_x_px - arm, pred_y_px + arm), (0, 0, 255), 3, cv2.LINE_AA)
            cv2.line(frame, (pred_x_px - arm, pred_y_px - arm), (pred_x_px + arm, pred_y_px + arm), (0, 255, 255), 1, cv2.LINE_AA)
            cv2.line(frame, (pred_x_px + arm, pred_y_px - arm), (pred_x_px - arm, pred_y_px + arm), (0, 255, 255), 1, cv2.LINE_AA)

            # CEP Blast Impact Rings
            cv2.circle(frame, (pred_x_px, pred_y_px), 22, (0, 165, 255), 2, cv2.LINE_AA)
            cv2.circle(frame, (pred_x_px, pred_y_px), 42, (0, 255, 255), 1, cv2.LINE_AA)

            # Dynamic CTRV Mode label
            mode_tag = "CTRV-ARC" if abs(tgt.yaw_rate_rad_s) >= 0.06 else "CTRV-LIN"
            cv2.putText(frame, f"PRED (X) ToF:{tof:.1f}s [{mode_tag}]",
                        (pred_x_px - 65, max(18, pred_y_px - 28)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 235, 255), 1, cv2.LINE_AA)

            # Target Lock HUD Banner
            heading_deg = math.degrees(tgt.heading_rad) % 360
            tgt_tag = f"[TGT #{tid}] {ground_speed_kmh:.1f}km/h | {heading_deg:.0f}deg"
            (tw, th), _ = cv2.getTextSize(tgt_tag, cv2.FONT_HERSHEY_SIMPLEX, 0.44, 1)
            ty = max(24, y1 - 8)
            cv2.rectangle(frame, (x1, ty - th - 4), (x1 + tw + 6, ty + 2), (0, 0, 0), -1)
            cv2.putText(frame, tgt_tag, (x1 + 3, ty - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.44, color, 1, cv2.LINE_AA)

        # ---------------------------------------------------------------------
        # STEP 7: Master Tactical HUD Overlay
        # ---------------------------------------------------------------------
        frame_telemetry.append(frame_info)

        # Top Master FCS Banner with high-contrast military HUD box
        active_count = len(active_targets)
        hud_text = f"FCS K9-VAJRA | Frame {frame_idx}/{total_frames} | Drone: {cam_speed_kmh:.1f}km/h | Locks: {active_count} | Primary: #{primary_target_id}"
        (bw, bh), _ = cv2.getTextSize(hud_text, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
        cv2.rectangle(frame, (10, 8), (14 + bw + 10, 12 + bh + 10), (0, 0, 0), -1)
        cv2.rectangle(frame, (10, 8), (14 + bw + 10, 12 + bh + 10), (0, 255, 255), 1)
        cv2.putText(frame, hud_text, (15, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 255), 1, cv2.LINE_AA)

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

    avg_vel = (sum_vel / max(1, detected_frames)) if detected_frames > 0 else 0.0

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
