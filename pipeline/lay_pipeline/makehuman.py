"""Readers for MakeHuman's CC0 data files (base mesh, targets, rigs, weights, vertex groups)."""
import gzip
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
# Source data: the CC0 assets bundled in MPFB2's repository (see pipeline/fetch_sources.py)
DATA = os.path.join(REPO, "assets-src", "mpfb2-2.0.17", "src", "mpfb", "data")


def load_obj(path=None):
    """Base mesh: positions (V,3) in MakeHuman units (decimetres, Y-up), faces (list of index lists),
    uvs (T,2), face uv indices, and OBJ groups {name: set of face indices}."""
    path = path or os.path.join(DATA, "3dobjs", "base.obj")
    v, vt, faces, ftex, groups = [], [], [], [], {}
    group = None
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                vt.append([float(x) for x in line.split()[1:3]])
            elif line.startswith("g "):
                group = line.split(maxsplit=1)[1].strip()
            elif line.startswith("f "):
                idx = [p.split("/") for p in line.split()[1:]]
                faces.append([int(p[0]) - 1 for p in idx])
                ftex.append([int(p[1]) - 1 if len(p) > 1 and p[1] else -1 for p in idx])
                groups.setdefault(group, set()).add(len(faces) - 1)
    return dict(positions=np.array(v), uvs=np.array(vt), faces=faces, face_uvs=ftex, groups=groups)


def load_target(rel, data=DATA):
    """Sparse target: (indices (N,), deltas (N,3)). `rel` is relative to targets/, without extension."""
    path = os.path.join(data, "targets", rel + ".target.gz")
    idx, d = [], []
    with gzip.open(path, "rt") as f:
        for line in f:
            p = line.split()
            if len(p) == 4 and not line.startswith("#"):
                idx.append(int(p[0]))
                d.append([float(x) for x in p[1:]])
    return np.array(idx, dtype=np.int64), np.array(d).reshape(-1, 3)


def apply_targets(base, stack, cache=None):
    out = base.copy()
    for rel, w in stack.items():
        if cache is not None and rel in cache:
            i, d = cache[rel]
        else:
            i, d = load_target(rel)
            if cache is not None:
                cache[rel] = (i, d)
        np.add.at(out, i, d * w)
    return out


def load_vertex_groups(data=DATA):
    """{group name: vertex index list}, from MakeHuman's mesh metadata (inclusive [first, last] ranges)."""
    raw = json.load(open(os.path.join(data, "mesh_metadata", "basemesh_vertex_groups.json")))
    out = {}
    for name, ranges in raw.items():
        idx = []
        for a, b in ranges:
            idx.extend(range(a, b + 1))
        out[name] = idx
    return out


def load_rig(name, data=DATA):
    return json.load(open(os.path.join(data, "rigs", "standard", f"rig.{name}.json")))


def load_weights(name, data=DATA):
    return json.load(open(os.path.join(data, "rigs", "standard", f"weights.{name}.json")))["weights"]
