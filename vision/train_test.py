from ultralytics import YOLO

if __name__ == "__main__":
    model = YOLO("yolov8s.pt")
    model.train(
        data="C:/fire_project/data.yaml",
        epochs=1,
        imgsz=640,
        batch=8,
        workers=4,
        device=0,
        fraction=0.05,
        project="C:/fire_project/runs",
        name="test_run",
    )
