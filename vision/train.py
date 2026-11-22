from ultralytics import YOLO

if __name__ == "__main__":
    model = YOLO("yolov8s.pt")
    model.train(
        data="C:/Fire_project/data.yaml",
        epochs=30,
        imgsz=640,
        batch=16,
        workers=8,
        device=0,
        patience=10,
        project="C:/Fire_project/runs",
        name="dfire_v1",
    )
