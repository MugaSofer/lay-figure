"""Assemble Spike B renders into one labelled sheet per joint: rows = angles, columns = methods."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
METHODS = ["LBS", "DQS", "LBS+CS", "CoR", "CoR+CS"]
JOINTS = {"shoulder": ["0", "90", "170"], "elbow": ["45", "100", "145"], "wrist": ["-70", "60", "twist90"],
          "hip": ["45", "90", "120"], "knee": ["45", "100", "150"]}
try:
    font = ImageFont.truetype("arial.ttf", 22)
except OSError:
    font = ImageFont.load_default()
for joint, angles in JOINTS.items():
    tiles = [[Image.open(os.path.join(src, f"{joint}_{a}_{m}.png")).convert("RGB") for m in METHODS] for a in angles]
    w, h = tiles[0][0].size
    pad, top, left = 4, 34, 110
    sheet = Image.new("RGB", (left + len(METHODS) * (w + pad), top + len(angles) * (h + pad)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for c, m in enumerate(METHODS):
        d.text((left + c * (w + pad) + w // 2 - 30, 6), m, fill="white", font=font)
    for r, a in enumerate(angles):
        d.text((8, top + r * (h + pad) + h // 2 - 12), f"{joint}\n{a}" + ("°" if a.lstrip("-").isdigit() else ""), fill="white", font=font)
        for c in range(len(METHODS)):
            sheet.paste(tiles[r][c], (left + c * (w + pad), top + r * (h + pad)))
    sheet.save(os.path.join(dst, f"spikeB_{joint}.png"))
    print("wrote", joint)
