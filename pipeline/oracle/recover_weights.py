"""Black-box analysis: recover the target weights MPFB actually applied, by least squares over all macro
targets, and print them next to ours. Diagnostic only.

  python pipeline/oracle/recover_weights.py <index into settings.json> [...]
"""
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lay_pipeline import makehuman as mh  # noqa: E402
from lay_pipeline.macros import macro_stack  # noqa: E402

TMP = os.environ.get("LAY_TMP", os.path.join(mh.REPO, "assets-src", "oracle"))
settings = json.load(open(os.path.join(TMP, "settings.json")))
theirs = np.load(os.path.join(TMP, "mpfb.npz"))["coords"]
obj = mh.load_obj()
base = obj["positions"]
tdir = os.path.join(mh.DATA, "targets")
rels = sorted(os.path.relpath(p, tdir).replace("\\", "/")[: -len(".target.gz")]
              for p in glob.glob(os.path.join(tdir, "macrodetails", "**", "*.target.gz"), recursive=True))
rels += sorted(os.path.relpath(p, tdir).replace("\\", "/")[: -len(".target.gz")]
               for p in glob.glob(os.path.join(tdir, "breast", "*-*-*-*-*-*.target.gz")))
A = np.zeros((base.size, len(rels)), dtype=np.float32)
for k, r in enumerate(rels):
    i, d = mh.load_target(r)
    col = np.zeros_like(base)
    col[i] = d
    A[:, k] = col.ravel()
for arg in sys.argv[1:]:
    n = int(arg)
    t = theirs[n]
    t_obj = np.stack([t[:, 0], t[:, 2], -t[:, 1]], 1) / 0.1
    w, *_ = np.linalg.lstsq(A, (t_obj - base).ravel(), rcond=None)
    ours = macro_stack(settings[n])
    print(f"--- #{n} {json.dumps(settings[n])[:100]}")
    rows = sorted(set([r for r, x in zip(rels, w) if abs(x) > 2e-3]) | set(ours), key=lambda r: -abs(w[rels.index(r)]))
    for r in rows:
        print(f"  {w[rels.index(r)]:8.4f}  ours {ours.get(r, 0):7.4f}  {r}")
