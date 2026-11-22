import numpy as np
from ultralytics import YOLO

if __name__ == "__main__":
    model = YOLO("C:/Fire_project/runs/dfire_v1/weights/best.pt")
    m = model.val(data="C:/Fire_project/data.yaml", device=0, workers=2,
                  plots=False, verbose=False)
    px = m.box.px
    print("\nSeuil | " + " | ".join(f"{n} (précision / rappel)" for n in model.names.values()))
    for conf in [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]:
        i = int(np.argmin(np.abs(px - conf)))
        cols = []
        for k in model.names:
            cols.append(f"{m.box.p_curve[k][i]:.2f} / {m.box.r_curve[k][i]:.2f}")
        print(f"{conf:.2f}  | " + " | ".join(cols))
