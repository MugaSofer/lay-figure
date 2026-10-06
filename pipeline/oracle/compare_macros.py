"""Compare our macro implementation with MPFB's output (black-box), vertex by vertex.

  python pipeline/oracle/compare_macros.py            # generates settings, runs Blender, compares
"""
import json
import os
import random
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lay_pipeline import makehuman as mh  # noqa: E402
from lay_pipeline.macros import macro_stack, LEVELS, RACES  # noqa: E402

BLENDER = r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"
TMP = os.environ.get("LAY_TMP", os.path.join(mh.REPO, "assets-src", "oracle"))
os.makedirs(TMP, exist_ok=True)

random.seed(1)
settings = [{}]
for k in LEVELS:  # single-slider sweeps
    for v in (0.0, 0.25, 0.75, 1.0):
        settings.append({k: v})
for _ in range(30):  # random mixes
    s = {k: random.random() for k in LEVELS}
    r = [random.random() for _ in RACES]
    s["race"] = {name: x / sum(r) for name, x in zip(RACES, r)}
    settings.append(s)

sfile, ofile = os.path.join(TMP, "settings.json"), os.path.join(TMP, "mpfb.npz")
json.dump(settings, open(sfile, "w"))
if not os.path.exists(ofile) or "--rerun" in sys.argv:
    subprocess.run([BLENDER, "-b", "--factory-startup", "-P", os.path.join(os.path.dirname(__file__), "mpfb_dump.py"),
                    "--", sfile, ofile], check=True, capture_output=True)
theirs = np.load(ofile)["coords"]

obj = mh.load_obj()
cache = {}
worst = 0
for s, t in zip(settings, theirs):
    ours = mh.apply_targets(obj["positions"], macro_stack(s), cache)
    ours = np.stack([ours[:, 0], -ours[:, 2], ours[:, 1]], 1) * 0.1  # MakeHuman Y-up dm -> Blender Z-up m
    err = np.abs(ours - t).max()
    worst = max(worst, err)
    if err > 1e-4:
        print(f"MISMATCH {err * 1000:.3f} mm for {json.dumps(s)[:120]}")
print(f"{len(settings)} bodies, worst vertex error {worst * 1000:.4f} mm")
