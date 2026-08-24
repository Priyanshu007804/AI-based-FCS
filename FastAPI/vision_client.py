"""
Vision Client (The Deep Learning Eye)
--------------------------------------
Computer Vision client using Ultralytics YOLOv8 nano model and OpenCV to:
1. Capture live webcam video feed.
2. Detect moving target ('car' class).
3. Compute real-time center coordinates and estimated physical velocity.
4. Stream telemetry to local FastAPI server via HTTP POST /update-target-state.
5. Render dynamic telemetry overlay (bounding box, velocity vector, FPS).
"""

import time
import requests
import cv2
import numpy as np
from ultralytics import YOLO

# -----------------------------------------------------------------------------
# Configuration Constants
# -----------------------------------------------------------------------------
FASTAPI_ENDPOINT = "http://localhost:8000/update-target-state"
CAR_ID = "car_tracker_01"

# Calibration: scale pixels to meters (e.g. 1 pixel = 0.005 meters = 5 mm)
# Adjust METERS_PER_PIXEL according to camera height and FOV field setup
METERS_PER_PIXEL = 0.005

# Velocity smoothing factor (Exponential Moving Average alpha, 0.0 to 1.0)
VELOCITY_EMA_ALPHA = 0.4

# COCO Dataset Class Index for 'car' is 2
CAR_CLASS_ID = 2


def main():
    print("=" * 60)
    print("  Civilian Target Tracking - Vision Client (YOLOv8 Nano)")
    print("=" * 60)
    print(f"[*] Target Endpoint: {FASTAPI_ENDPOINT}")
    print("[*] Loading YOLOv8 Nano model ('yolov8n.pt')...")

    # Load pre-trained YOLOv8 Nano model
    try:
        model = YOLO("yolov8n.pt")
    except Exception as e:
        print(f"[!] Error loading YOLO model: {e}")
        return

    print("[*] Initializing video capture (camera index 0)...")
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("[!] Warning: Webcam index 0 could not be opened.")
        print("[*] Attempting fallback to camera index 1...")
        cap = cv2.VideoCapture(1)
        if not cap.isOpened():
            print("[!] Critical: No webcam available! Please check camera connection.")
            return

    # Set camera resolution (640x480 for fast real-time inference)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    prev_x_m: float = 0.0
    prev_y_m: float = 0.0
    prev_timestamp: float = 0.0

    smooth_vx: float = 0.0
    smooth_vy: float = 0.0

    first_detection = True
    last_post_status = "Waiting for detection..."
    last_post_success = False

    fps = 0.0
    frame_count = 0
    fps_start_time = time.time()

    print("[*] Vision tracking loop active. Press 'q' in video window to exit.")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("[!] Failed to grab frame from video stream.")
                break

            current_timestamp = time.time()
            frame_count += 1

            # Compute FPS every 10 frames
            if frame_count % 10 == 0:
                elapsed_fps_time = current_timestamp - fps_start_time
                if elapsed_fps_time > 0:
                    fps = 10.0 / elapsed_fps_time
                fps_start_time = current_timestamp

            # Run YOLOv8 inference on frame (verbose=False suppresses console logs per frame)
            results = model(frame, verbose=False)[0]

            detected_car = None
            highest_conf = 0.0

            # Filter detections specifically for 'car' class
            for box in results.boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())

                if cls_id == CAR_CLASS_ID and conf > highest_conf:
                    highest_conf = conf
                    detected_car = box

            if detected_car is not None:
                # Extract bounding box coordinates [x1, y1, x2, y2]
                xyxy = detected_car.xyxy[0].cpu().numpy()
                x1, y1, x2, y2 = map(int, xyxy)

                # Compute center pixel coordinates
                center_x_px = (x1 + x2) / 2.0
                center_y_px = (y1 + y2) / 2.0

                # Convert center coordinates to metric distance relative to frame origin
                current_x_m = center_x_px * METERS_PER_PIXEL
                current_y_m = center_y_px * METERS_PER_PIXEL

                # Compute instantaneous velocity (m/s)
                if not first_detection and prev_timestamp > 0:
                    dt = current_timestamp - prev_timestamp
                    if dt > 0.001:
                        raw_vx = (current_x_m - prev_x_m) / dt
                        raw_vy = (current_y_m - prev_y_m) / dt

                        # Apply Exponential Moving Average (EMA) filtering to smooth velocity noise
                        smooth_vx = (VELOCITY_EMA_ALPHA * raw_vx) + ((1.0 - VELOCITY_EMA_ALPHA) * smooth_vx)
                        smooth_vy = (VELOCITY_EMA_ALPHA * raw_vy) + ((1.0 - VELOCITY_EMA_ALPHA) * smooth_vy)
                else:
                    first_detection = False
                    smooth_vx = 0.0
                    smooth_vy = 0.0

                prev_x_m = current_x_m
                prev_y_m = current_y_m
                prev_timestamp = current_timestamp

                # Prepare payload for FastAPI server
                payload = {
                    "car_id": CAR_ID,
                    "current_x": round(current_x_m, 4),
                    "current_y": round(current_y_m, 4),
                    "current_z": 0.0,
                    "velocity_x": round(smooth_vx, 4),
                    "velocity_y": round(smooth_vy, 4),
                    "timestamp": round(current_timestamp, 4)
                }

                # Send telemetry payload to FastAPI backend
                try:
                    resp = requests.post(FASTAPI_ENDPOINT, json=payload, timeout=0.2)
                    if resp.status_code == 200:
                        last_post_status = f"HTTP 200 OK (x: {current_x_m:.2f}m, vx: {smooth_vx:.2f}m/s)"
                        last_post_success = True
                    else:
                        last_post_status = f"HTTP Error {resp.status_code}"
                        last_post_success = False
                except requests.exceptions.RequestException as req_err:
                    last_post_status = f"Conn Refused: FastAPI Server offline?"
                    last_post_success = False

                # -------------------------------------------------------------
                # Draw Visual Overlay
                # -------------------------------------------------------------
                # Bounding box
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

                # Center crosshair point
                cx_int, cy_int = int(center_x_px), int(center_y_px)
                cv2.circle(frame, (cx_int, cy_int), 5, (0, 0, 255), -1)

                # Velocity vector arrow
                arrow_end_x = int(cx_int + (smooth_vx / METERS_PER_PIXEL) * 0.3)
                arrow_end_y = int(cy_int + (smooth_vy / METERS_PER_PIXEL) * 0.3)
                cv2.arrowedLine(frame, (cx_int, cy_int), (arrow_end_x, arrow_end_y), (255, 255, 0), 2, tipLength=0.3)

                # Label background & text
                label_text = f"Car: {highest_conf:.2f} | Pos: ({current_x_m:.2f}m, {current_y_m:.2f}m) | Vx: {smooth_vx:.2f}m/s"
                cv2.putText(frame, label_text, (x1, max(20, y1 - 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

            else:
                last_post_status = "No car target detected"
                first_detection = True

            # HUD Display overlay
            status_color = (0, 255, 0) if last_post_success else (0, 0, 255)
            cv2.putText(frame, f"FPS: {fps:.1f}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.putText(frame, f"Backend: {last_post_status}", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, status_color, 2)
            cv2.putText(frame, "Press 'q' to exit", (10, frame.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

            cv2.imshow("Civilian Car Tracking - Vision Client", frame)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                print("[*] Exit requested by user ('q' key).")
                break

    except KeyboardInterrupt:
        print("\n[*] Interrupted by user.")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("[*] Video capture released. Vision client terminated cleanly.")


if __name__ == "__main__":
    main()
