import csv
import cv2
from ultralytics import YOLO

MODEL = "C:/Fire_project/runs/dfire_v1/weights/best.pt"
VIDEO = "C:/Fire_project/video_test.mp4"
OUT_VIDEO = "C:/Fire_project/video_test_resultat.mp4"
OUT_CSV = "C:/Fire_project/video_test_detections.csv"
CONF = 0.25

if __name__ == "__main__":
    model = YOLO(MODEL)
    cap = cv2.VideoCapture(VIDEO)
    if not cap.isOpened():
        raise SystemExit("Impossible d'ouvrir la vidéo : vérifie le chemin et le nom du fichier.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(OUT_VIDEO, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    frame_idx = 0
    frames_fire = frames_smoke = 0

    with open(OUT_CSV, "w", newline="") as f:
        csv_writer = csv.writer(f)
        csv_writer.writerow(["frame", "time_s", "classe", "confiance", "x1", "y1", "x2", "y2"])

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            r = model.predict(frame, conf=CONF, verbose=False, device=0)[0]
            names_in_frame = set()

            for box, cls, conf in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                name = model.names[int(cls)]
                names_in_frame.add(name)
                x1, y1, x2, y2 = [round(v) for v in box]
                csv_writer.writerow([frame_idx, round(frame_idx / fps, 2), name, round(conf, 3), x1, y1, x2, y2])

            if "fire" in names_in_frame:
                frames_fire += 1
            if "smoke" in names_in_frame:
                frames_smoke += 1

            writer.write(r.plot())
            frame_idx += 1

    cap.release()
    writer.release()
    print(f"Images analysées : {frame_idx}")
    print(f"Images avec feu : {frames_fire} | avec fumée : {frames_smoke}")
    print(f"Vidéo annotée : {OUT_VIDEO}")
    print(f"Détections : {OUT_CSV}")
