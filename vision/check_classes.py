import glob, os, cv2

root = "C:/fire_project/DFire/train"
found = 0
for lbl in glob.glob(root + "/labels/*.txt"):
    lines = open(lbl).read().strip().splitlines()
    if not lines:
        continue
    stem = os.path.splitext(os.path.basename(lbl))[0]
    img_path = None
    for ext in (".jpg", ".jpeg", ".png"):
        p = f"{root}/images/{stem}{ext}"
        if os.path.exists(p):
            img_path = p
            break
    if img_path is None:
        continue
    img = cv2.imread(img_path)
    h, w = img.shape[:2]
    for line in lines:
        c, x, y, bw, bh = line.split()[:5]
        x, y, bw, bh = float(x) * w, float(y) * h, float(bw) * w, float(bh) * h
        p1 = (int(x - bw / 2), int(y - bh / 2))
        p2 = (int(x + bw / 2), int(y + bh / 2))
        cv2.rectangle(img, p1, p2, (0, 0, 255), 3)
        cv2.putText(img, f"class {c}", p1, cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 3)
    cv2.imwrite(f"check_{found}.jpg", img)
    found += 1
    if found == 4:
        break
