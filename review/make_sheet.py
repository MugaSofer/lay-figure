"""Contact sheet of a milestone's regression renders: rows = scenes, columns = cameras.

  python review/make_sheet.py m1 [scale]
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ms = sys.argv[1] if len(sys.argv) > 1 else "m1"
scale = float(sys.argv[2]) if len(sys.argv) > 2 else 0.4
CAMS = ["front", "three-quarter", "side"]
d = os.path.join(HERE, ms)
scenes = sorted({f.rsplit("-", 1)[0] if not f.endswith("three-quarter.png") else f[: -len("-three-quarter.png")]
                 for f in os.listdir(d) if f.endswith(".png") and not f.startswith("sheet")})
scenes = sorted({f[: -len(f"-{c}.png")] for f in os.listdir(d) for c in CAMS if f.endswith(f"-{c}.png")})
tiles = [[Image.open(os.path.join(d, f"{s}-{c}.png")).convert("RGB") for c in CAMS] for s in scenes]
w, h = tiles[0][0].size
w, h = int(w * scale), int(h * scale)
try:
    font = ImageFont.truetype("arial.ttf", 18)
except OSError:
    font = ImageFont.load_default()
left, top = 170, 30
sheet = Image.new("RGB", (left + 3 * w, top + len(scenes) * h), (24, 24, 24))
dr = ImageDraw.Draw(sheet)
for c, cam in enumerate(CAMS):
    dr.text((left + c * w + 8, 6), cam, fill="white", font=font)
for r, s in enumerate(scenes):
    dr.text((8, top + r * h + h // 2 - 10), s, fill="white", font=font)
    for c in range(3):
        sheet.paste(tiles[r][c].resize((w, h), Image.LANCZOS), (left + c * w, top + r * h))
path = os.path.join(d, "sheet.jpg")
sheet.save(path, quality=85)
print(path, sheet.size)
