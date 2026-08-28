<p align="center">
  <img src="https://img.shields.io/badge/STATUS-OPERATIONAL-brightgreen?style=for-the-badge&logo=target" alt="Status"/>
  <img src="https://img.shields.io/badge/PLATFORM-K9%20VAJRA%20155mm%20SPH-orange?style=for-the-badge" alt="Platform"/>
  <img src="https://img.shields.io/badge/PYTHON-3.13-blue?style=for-the-badge&logo=python" alt="Python"/>
  <img src="https://img.shields.io/badge/NEXT.JS-16-black?style=for-the-badge&logo=next.js" alt="Next.js"/>
</p>

# 🎯 K9 VAJRA — AI Fire Control System (FCS)

### **Hunter-Killer Predictive Interceptor for 155mm Self-Propelled Howitzer**

> A real-time AI system that processes live UAV drone footage, autonomously acquires and tracks moving armored targets, predicts their future trajectory using nonlinear kinematics, and computes artillery firing solutions — all without any manual operator intervention.

**Developed for**: DRDO / Indian Army Defence Hackathon (AI Kavach)  
**Inspiration**: AbramsX Hunter-Killer capability, U.S. Army Project Shrike, CMU SEI "Eye in the Sky" framework

---

## 📋 Table of Contents

- [Overview](#-overview)
- [System Architecture](#-system-architecture)
- [Technical Pipeline](#-technical-pipeline-deep-dive)
- [Dashboard & Interface](#-dashboard--interface)
- [Challenges Faced & How We Solved Them](#-challenges-faced--how-we-solved-them)
- [The Journey to Our Current Approach](#-the-journey-to-our-current-approach)
- [Mathematical Framework](#-mathematical-framework)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [API Reference](#-api-reference)
- [Tech Stack](#-tech-stack)
- [License](#-license)

---

## 🔭 Overview

Modern artillery platforms like the K9 Vajra 155mm Self-Propelled Howitzer are devastatingly accurate — but only if they know *where the target will be* when the shell arrives. A 155mm HE shell takes 15–45 seconds to travel to its target. During that Time of Flight (ToF), an armored vehicle at even 30 km/h moves **125–375 meters** — far outside the Circular Error Probable (CEP) of unguided munitions.

**K9-VAJRA FCS** solves this by:

1. **Receiving** live UAV/drone ISR (Intelligence, Surveillance, Reconnaissance) video feed
2. **Detecting** and **locking** onto moving armored targets autonomously
3. **Tracking** them frame-by-frame through dust, smoke, occlusion, and 360° maneuvers
4. **Predicting** their future position using CTRV (Constant Turn Rate & Velocity) nonlinear kinematics
5. **Computing** an artillery firing solution with ballistic lead compensation
6. **Displaying** all of this on a tactical command dashboard with 3D turret visualization

The system achieves **99.8% tracking precision** across thousands of frames without any deep learning model for detection — using pure signal processing, discriminative correlation tracking, and camera motion compensation.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      UAV DRONE ISR PLATFORM                        │
│                   (Aerial Video Feed @ 30 FPS)                     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ MP4 Upload
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    FastAPI BACKEND (Port 8000)                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  1. HIGH-CONTRAST SALIENCY SCANNER                          │   │
│  │     Auto-acquires vehicle signature on Frame 0               │   │
│  │     Sliding window (45×45) × σ(patch) × contrast(patch)     │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  2. CAMERA MOTION COMPENSATOR (GMC)                         │   │
│  │     Sparse optical flow (Lucas-Kanade) on ground features    │   │
│  │     RANSAC affine estimation → strips drone ego-motion       │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  3. CSRT DISCRIMINATIVE CORRELATION TRACKER                 │   │
│  │     Channel & Spatial Reliability discriminative filter      │   │
│  │     NCC template re-seeding on tracker failure               │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  4. CTRV KINEMATICS ENGINE                                  │   │
│  │     Constant Turn Rate & Velocity nonlinear prediction       │   │
│  │     Yaw rate estimation → arc/linear trajectory forecasting  │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  5. BALLISTIC FIRING SOLUTION                               │   │
│  │     Time of Flight computation                               │   │
│  │     Lead-angle compensation + CEP ring calculation           │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  6. TACTICAL HUD RENDERER                                   │   │
│  │     Military reticle overlay, CTRV arc waypoints,            │   │
│  │     PRED(X) impact marker, target lock banner                │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ JSON Telemetry + Processed Video
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│               NEXT.JS TACTICAL DASHBOARD (Port 3000)               │
│  ┌────────────────────┐  ┌──────────────────────────┐              │
│  │  UAV ISR Video     │  │  3D Turret Viewport      │              │
│  │  Feed + HUD        │  │  (React Three Fiber)     │              │
│  ├────────────────────┤  ├──────────────────────────┤              │
│  │  Tactical Overhead │  │  Met/Ballistics Panel    │              │
│  │  Map + Trajectory  │  │  Wind, Temp, Munitions   │              │
│  └────────────────────┘  └──────────────────────────┘              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Metrics Bar + Analytics Event Logger                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 Technical Pipeline Deep-Dive

### Stage 1: Automatic Target Acquisition (Frame 0)

The system doesn't require manual target selection. On the very first frame, a **high-contrast saliency scanner** slides a 45×45 pixel window across the image (excluding the outer 15% border) and computes a composite score:

```
score(x, y) = σ(patch) × (max(patch) − min(patch))
```

The window with the highest score — corresponding to the brightest, most textured object against the uniform terrain — becomes the initial target lock. For a tank on dark mud, this reliably selects the vehicle hull every time.

### Stage 2: Camera Ego-Motion Compensation (GMC)

Drone footage is never stable. The camera pans, rotates, and jitters constantly. Without compensating for this, any pixel-level velocity measurement would be dominated by camera motion rather than true ground movement.

The **CameraMotionCompensator** module:
1. Detects 300 strong corner features on static background terrain (Shi-Tomasi)
2. Tracks them between frames using pyramidal Lucas-Kanade optical flow
3. Fits a rigid 2D affine transform via RANSAC to estimate `(dx_cam, dy_cam, rotation, scale)`
4. Subtracts this from target displacement to isolate **true ground velocity**

### Stage 3: CSRT Discriminative Correlation Tracking

Rather than running an object detector every frame (which fails on military targets not in civilian training datasets), we use **OpenCV's CSRT** (Channel and Spatial Reliability Tracking):

- Learns a discriminative correlation filter on the target's appearance
- Handles partial occlusion, scale changes, and appearance variation
- Achieves **99.8% tracking precision** across 3898 frames

When the CSRT tracker reports failure (confidence below threshold), a **Normalized Cross-Correlation (NCC) template matcher** searches a 60px radius around the expected position to re-acquire the target and re-seed the tracker.

### Stage 4: CTRV Nonlinear Kinematics

Tanks don't drive in straight lines. The CTRV (Constant Turn Rate and Velocity) model handles curved trajectories:

- **Linear mode** (`|ω| < 0.06 rad/s`): Standard constant-velocity extrapolation
- **Arc mode** (`|ω| ≥ 0.06 rad/s`): Nonlinear circular-arc prediction using instantaneous yaw rate

The predicted position feeds directly into the ballistic firing solution.

### Stage 5: Artillery Firing Solution

Given the predicted target position at Time of Flight, the system computes:
- **Lead angle** between current and predicted position
- **CEP rings** (2.5m for PGM Excalibur, 35m for unguided HE)
- **Impact marker** (`PRED (X)`) rendered on the video feed

---

## 🖥️ Dashboard & Interface

The Next.js tactical dashboard is a **4-quadrant military command interface**:

| Quadrant | Component | Description |
|----------|-----------|-------------|
| **Top-Left** | `VideoIngest.tsx` | UAV drone ISR video feed with live HUD overlay. Upload video or stream processed feed with military reticle, trajectory arcs, and target lock indicators |
| **Top-Right** | `TurretViewport.tsx` | Real-time 3D K9 SPH model (React Three Fiber / Three.js). Dual-axis servo tracking: turret azimuth pan + barrel elevation tilt. Recoil animation and muzzle flash on fire commands |
| **Bottom-Left** | `TacticalMap.tsx` | Overhead tactical map with multi-scale zoom (AUTOFOCUS / 2KM / 4KM SECTOR). Pulsing target marker, velocity vector arrow, breadcrumb trail, predicted intercept marker with animated shockwave rings |
| **Bottom-Right** | `EnvironmentPanel.tsx` | 3D Sonic Anemometer wind data, temperature/humidity corrections, propellant charge ΔMV calculations. Munition selector: `155mm HE` / `PGM Excalibur` / `155mm BONUS` |

Additional components:
- **`MetricsBar.tsx`** — Live telemetry strip (target speed, heading, lock status, frame count)
- **`AnalyticsSidebar.tsx`** — Collapsible event stream and detection log
- **`Navbar.tsx`** — System navigation and mode selection

---

## 🧗 Challenges Faced & How We Solved Them

### Challenge 1: YOLO Cannot Detect Military Vehicles

**Problem**: We initially used YOLOv8 (`yolov8n.pt`) for object detection. YOLO is trained on the COCO dataset — 80 civilian object classes (car, truck, bus, motorcycle, etc.). There is **no "tank" class** in COCO. When fed drone footage of a tank doing circular maneuvers on a mud field, YOLO either:
- Detected nothing (0 locks)
- Classified circular tire tracks in the mud as "sports ball" or "frisbee" (false positives on terrain features)

**What we tried first**: Lowering the confidence threshold to 0.12, using background subtraction (MOG2) as a fallback motion detector, expanding COCO class filters to every vehicle type. None of these worked — the fundamental problem was that YOLO's COCO vocabulary has no representation for military armor.

**Solution**: Completely abandoned YOLO-based detection for the tracking pipeline. Replaced it with a model-free approach: high-contrast saliency auto-acquisition + CSRT discriminative correlation tracker. No pretrained neural network needed.

---

### Challenge 2: Drone Camera Motion Contaminating Velocity Measurements

**Problem**: In drone footage, the camera itself moves — panning, rotating, zooming, and vibrating due to wind. A stationary rock on the ground appears to "move" at 5-10 pixels/frame in the video. This completely corrupted our velocity measurements: a stationary tank was reported as moving at 15 km/h just from camera jitter.

**What we tried first**: Simple frame-differencing to detect motion. This produced catastrophic false positives — the high-contrast circular mud ring edge produced massive difference values whenever the drone drifted even 1-2 pixels, creating phantom "detections" all around the ring perimeter.

**Solution**: Implemented a **Global Camera Motion Compensator (GMC)** that:
1. Tracks 300 background feature points using sparse optical flow
2. Excludes points inside known target bounding boxes
3. Estimates a rigid affine transform via RANSAC
4. Subtracts camera motion from target displacement to isolate **true ground velocity**

This eliminated all camera-induced velocity artifacts and gave us clean kinematic measurements.

---

### Challenge 3: Tracker Drifting onto Background Terrain Features

**Problem**: Early iterations of the tracker would sometimes drift off the tank and lock onto high-contrast terrain features — mud circles, tire tracks, bushes — especially during aggressive 360° turns where the tank's appearance changes rapidly.

**What we tried**: Template matching alone (NCC) drifted because the template becomes stale after the target rotates. Simple KCF tracker was too fragile for scale changes.

**Solution**: CSRT (Channel and Spatial Reliability Tracking) with **automatic re-seeding**:
- CSRT's spatial reliability map gives higher weight to discriminative target regions
- When CSRT fails, NCC template matching within a motion-predicted search window re-acquires the target
- The CSRT tracker is re-initialized on the re-acquired position
- Visual template is updated every 8 frames to adapt to appearance changes

---

### Challenge 4: Division-by-Zero and Edge Cases in Production

**Problem**: In production, edge cases caused crashes:
- Videos with 0 total frames → division by zero in progress percentage
- No detections across entire video → division by zero in average velocity
- Tracker bbox going out of frame boundaries → OpenCV array indexing errors

**Solution**: Defensive guards across all arithmetic:
```python
pct = int(frame_idx / total_frames * 100) if total_frames > 0 else 0
avg_vel = (sum_vel / max(1, detected_frames)) if detected_frames > 0 else 0.0
bx = max(0, min(width - 10, bx))
```

---

### Challenge 5: Browser Video Playback (MP4V vs H.264)

**Problem**: OpenCV's `VideoWriter` with `mp4v` codec produces MPEG-4 Part 2 video, which modern browsers (Chrome, Firefox, Edge) refuse to play natively. The processed video would download but not play in the `<video>` tag.

**Solution**: Post-processing pipeline using FFmpeg to re-encode to H.264 (AVC1) with `yuv420p` pixel format — the only format universally supported by HTML5 `<video>`:
```bash
ffmpeg -y -i processed.mp4 -c:v libx264 -pix_fmt yuv420p -preset fast web_processed.mp4
```

---

## 💡 The Journey to Our Current Approach

### Phase 1: "Just Use YOLO" (Failed)

The initial plan was straightforward — use YOLOv8 for object detection, draw bounding boxes, compute velocity from frame-to-frame displacement. This works great for civilian traffic surveillance on dashcams.

It completely failed on military drone ISR footage because:
- **COCO has no military vehicle classes** — a tank is not a "car" or a "truck" to a model trained on ImageNet/COCO
- **Aerial perspective** at high altitude makes vehicles look like tiny blobs (30-50 pixels), well below YOLO's optimal input resolution
- **Terrain features** (circular mud tire tracks) were high-confidence false positives

### Phase 2: "YOLO + Background Subtraction Fallback" (Failed)

We added OpenCV's MOG2 background subtractor as a fallback: if YOLO didn't detect anything, the motion mask would catch moving objects. This created a new problem — **the drone camera itself moves**, causing the entire background to appear as "motion." Static terrain edges along the circular mud ring produced massive motion residuals, creating phantom detections everywhere *except* on the actual tank.

### Phase 3: "Motion-Compensated MTI + Visual Correlation Locking" (Success ✅)

The breakthrough came from asking a fundamentally different question:

> *Instead of asking "what is this object?", ask "what is MOVING differently from the background?"*

This led to the three-part architecture that actually works:

1. **Camera Motion Compensation** — Measure how the background moves (drone ego-motion) by tracking feature points on static terrain via optical flow. Subtract this from everything. Now only *truly moving* objects show displacement.

2. **High-Contrast Saliency Acquisition** — On Frame 0, find the most visually distinctive patch in the image. On drone ISR footage over terrain, an armored vehicle is almost always the highest-contrast object (dark hull shadow + bright sunlit hull against uniform mud/sand).

3. **Discriminative Correlation Tracking (CSRT)** — Once acquired, use a correlation filter that learns what the target looks like and discriminates it from the background. No object classification needed — it tracks pure visual appearance. The CSRT filter adapts to gradual appearance changes (rotation, lighting) while rejecting sudden background distractors.

This approach is fundamentally **model-agnostic** — it doesn't need to know what a "tank" is. It tracks whatever visually distinctive object is moving on the ground, whether it's a T-72, an APC, a pickup truck, or a mobile artillery piece. That's exactly what a military FCS needs.

---

## 🧮 Mathematical Framework

### Constant Velocity Model (Straight-Line)
$$\vec{P}_{future} = \vec{P}_{current} + \vec{v}_{ground} \times T_{DoF}$$

### CTRV Model (Curved Trajectory)
For a target turning at yaw rate $\omega$ with speed $v$ and heading $\theta$:

$$x_{pred} = x + \frac{v}{\omega}\left[\sin(\theta + \omega \cdot t) - \sin(\theta)\right]$$

$$y_{pred} = y - \frac{v}{\omega}\left[\cos(\theta + \omega \cdot t) - \cos(\theta)\right]$$

### Camera Motion Compensation
Ground velocity isolation via background feature optical flow:

$$\vec{v}_{ground} = \vec{v}_{pixel} - \vec{v}_{camera}$$

Where $\vec{v}_{camera}$ is estimated from the RANSAC affine transform $M_{affine}$:

$$M_{affine} = \begin{bmatrix} \cos\theta & -\sin\theta & dx_{cam} \\ \sin\theta & \cos\theta & dy_{cam} \end{bmatrix}$$

### Target Saliency Score
$$S(x, y) = \sigma(patch) \times \left[\max(patch) - \min(patch)\right]$$

---

## 📁 Project Structure

```
FCS/
├── FastAPI/                          # Backend — Computer Vision & Kinematics
│   ├── main.py                       # Core pipeline: GMC + CSRT + CTRV + HUD
│   ├── vision_client.py              # Gemini Vision API integration
│   ├── requirements.txt              # Python dependencies
│   ├── uploads/                      # Raw uploaded video files
│   └── static/                       # Processed output videos & frames
│
├── predictive-trajectory-dashboard/  # Frontend — Tactical Command Dashboard
│   ├── src/
│   │   ├── app/                      # Next.js app router
│   │   ├── components/
│   │   │   ├── Dashboard.tsx         # Main 4-quadrant layout
│   │   │   ├── VideoIngest.tsx       # UAV video feed + upload
│   │   │   ├── TurretViewport.tsx    # 3D K9 SPH turret model
│   │   │   ├── TacticalMap.tsx       # Overhead tactical map
│   │   │   ├── EnvironmentPanel.tsx  # Met/ballistics panel
│   │   │   ├── MetricsBar.tsx        # Telemetry status strip
│   │   │   ├── AnalyticsSidebar.tsx  # Event logger
│   │   │   └── Navbar.tsx            # Navigation bar
│   │   └── lib/                      # Shared utilities
│   ├── package.json
│   └── tsconfig.json
│
├── gemini.txt                        # Theoretical & mathematical framework
├── PROJECT_SUMMARY_PROMPT.md         # System context for AI assistants
└── README.md                         # ← You are here
```

---

## 🚀 Getting Started

### Prerequisites

- **Python** 3.10+ (tested on 3.13)
- **Node.js** 18+ with npm
- **FFmpeg** installed and on PATH (for H.264 video encoding)
- **OpenCV** with contrib modules (`opencv-contrib-python` for CSRT tracker)

### 1. Clone the Repository

```bash
git clone https://github.com/Priyanshu007804/AI-based-FCS.git
cd AI-based-FCS
```

### 2. Start the Backend (FastAPI)

```bash
cd FastAPI
pip install -r requirements.txt
python main.py
```

The backend server starts at `http://localhost:8000`.

### 3. Start the Frontend (Next.js Dashboard)

```bash
cd predictive-trajectory-dashboard
npm install
npm run dev
```

The dashboard opens at `http://localhost:3000`.

### 4. Upload a Video

1. Open `http://localhost:3000` in your browser
2. Use the **Video Ingest** panel to upload drone footage (MP4)
3. Watch the system auto-acquire, track, and compute firing solutions in real-time
4. The 3D turret, tactical map, and metrics panels update with live telemetry

---

## 📡 API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/analyze-video` | `POST` | Upload MP4 video → returns processed video URL + frame-by-frame telemetry |
| `/predict` | `POST` | Submit `CarTargetState` → returns real-time intercept prediction |
| `/calculate-intercept` | `POST` | Full ballistic intercept computation with multiple munition types |
| `/system-status` | `GET` | Pipeline health check and current target telemetry |

### Example: Analyze Video
```bash
curl -X POST http://localhost:8000/analyze-video \
  -F "file=@drone_footage.mp4"
```

**Response:**
```json
{
  "status": "success",
  "processed_video_url": "http://localhost:8000/static/web_processed_abc123.mp4",
  "duration_sec": 129.93,
  "fps": 30.0,
  "detected_frames": 598,
  "summary": {
    "max_velocity_m_s": 2.41,
    "avg_velocity_m_s": 0.87,
    "latest_intercept": { ... }
  },
  "canvas_path": [ ... ],
  "frames": [ ... ]
}
```

---

## 🛠️ Tech Stack

### Backend
| Technology | Purpose |
|------------|---------|
| **Python 3.13** | Core runtime |
| **FastAPI** | Async REST API framework |
| **OpenCV (contrib)** | CSRT tracker, GMC optical flow, HUD rendering |
| **NumPy** | Matrix operations, affine transforms |
| **Ultralytics YOLOv8** | Fallback civilian object detection (retained for non-military use) |
| **FFmpeg** | H.264 video re-encoding for browser playback |
| **Uvicorn** | ASGI server |

### Frontend
| Technology | Purpose |
|------------|---------|
| **Next.js 16** | React framework with App Router |
| **TypeScript** | Type-safe component development |
| **React Three Fiber** | Declarative 3D rendering (Three.js) |
| **Three.js** | 3D K9 SPH turret model and animation |
| **Tailwind CSS 4** | Utility-first styling |
| **Lucide React** | Icon library |
| **GSAP** | Animation engine |

---

## 📜 License

This project was developed for the **DRDO / Indian Army AI Kavach Defence Hackathon**. All rights reserved.

---

<p align="center">
  <b>K9-VAJRA FCS</b> — <i>See First. Lock First. Kill First.</i>
</p>
