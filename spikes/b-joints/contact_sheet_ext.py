"""Sheets for the extended set: one per pose, rows = views, columns = methods."""
import os
import sys
from collections import OrderedDict
from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
METHODS = ["LBS", "DQS", "LBS+CS", "CoR+CS"]
font = ImageFont.truetype("arial.ttf", 22)
poses = OrderedDict()
for f in sorted(os.listdir(src)):
    if f.endswith("_LBS.png"):
        stem = f[: -len("_LBS.png")]
        pose, view = stem.rsplit("_", 1)
        poses.setdefault(pose, []).append(view)
for pose, views in poses.items():
    tiles = [[Image.open(os.path.join(src, f"{pose}_{v}_{m}.png")).convert("RGB") for m in METHODS] for v in views]
    w, h = tiles[0][0].size
    pad, top, left = 4, 34, 120
    sheet = Image.new("RGB", (left + len(METHODS) * (w + pad), top + len(views) * (h + pad)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for c, m in enumerate(METHODS):
        d.text((left + c * (w + pad) + w // 2 - 30, 6), m, fill="white", font=font)
    for r, v in enumerate(views):
        d.text((8, top + r * (h + pad) + h // 2 - 12), f"{pose}\n{v}", fill="white", font=font)
        for c in range(len(METHODS)):
            sheet.paste(tiles[r][c], (left + c * (w + pad), top + r * (h + pad)))
    sheet.save(os.path.join(dst, f"ext_{pose}.png"))
print(list(poses))
