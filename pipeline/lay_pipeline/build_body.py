"""Build the app's body assets from MakeHuman's CC0 data.

  python -m lay_pipeline.build_body          (run from pipeline/)

Writes public/assets/body/:
  body.json         metadata: counts, bone list and placement, macro target index, file offsets
  body.bin.gz       base shape positions, render mesh (index, uv, shape-vertex map), skin weights
  macro-<age>.bin.gz  macro targets for one age level (baby/child/young/old), loaded on demand

Binaries are gzipped here because GitHub Pages won't compress .bin; the app inflates them with
the browser's DecompressionStream.

Units are metres, Y-up, the figure faces +Z (MakeHuman's own axes, scaled from decimetres).

"Shape space" is every vertex a target can move that the app needs: the body's vertices plus the
joint-helper vertices bones are placed from. Targets apply in shape space; the render mesh gathers
from it (UV seams duplicate vertices there, but they share one shape vertex, so seams can't open).
"""
import glob
import gzip
import hashlib
import json
import os
import struct
from collections import defaultdict

import numpy as np

from . import makehuman as mh

OUT = os.path.join(mh.REPO, "public", "assets", "body")
RIG = "game_engine"
MAX_INFLUENCES = 4
SCALE = 0.1  # decimetres -> metres
QUANT = 1e-4  # target deltas stored as int16 multiples of 0.1 mm (range +-3.2 m)
FORMAT_VERSION = 1


def body_faces(obj):
    return sorted(obj["groups"]["body"])


def build():
    obj = mh.load_obj()
    groups = mh.load_vertex_groups()
    rig = mh.load_rig(RIG)
    weights = mh.load_weights(RIG)
    body_v = np.array(groups["body"])

    # --- bones: placement from joint cubes / vertex means ---
    bone_names = []
    order = {}

    def visit(name):  # parents before children
        if name in order:
            return
        parent = rig[name].get("parent") or None
        if parent:
            visit(parent)
        order[name] = len(bone_names)
        bone_names.append(name)

    for n in rig:
        visit(n)

    helper_vs = set()

    def placement(spec):
        if spec["strategy"] == "CUBE":
            vs = groups[spec["cube_name"]]
        elif spec["strategy"] == "VERTEX":
            vs = [spec["vertex_index"]]
        elif spec["strategy"] == "MEAN":
            vs = list(spec["vertex_indices"])
        else:
            raise ValueError(spec["strategy"])
        helper_vs.update(v for v in vs if v >= len(body_v))
        return vs

    bones_raw = []
    for n in bone_names:
        b = rig[n]
        bones_raw.append(dict(name=n, parent=b.get("parent") or None, head=placement(b["head"]), tail=placement(b["tail"]),
                              roll=b.get("roll", 0.0)))
    # ground reference (feet on the floor for every body)
    ground_vs = groups["joint-ground"]
    helper_vs.update(ground_vs)

    # --- shape space: body vertices, then the helper vertices we need ---
    shape_src = np.concatenate([body_v, np.array(sorted(helper_vs), dtype=np.int64)])
    src_to_shape = {int(s): i for i, s in enumerate(shape_src)}
    n_shape = len(shape_src)
    base = obj["positions"][shape_src] * SCALE

    bones = []
    for b in bones_raw:
        bones.append(dict(name=b["name"], parent=bone_names.index(b["parent"]) if b["parent"] else -1,
                          head=[src_to_shape[v] for v in b["head"]], tail=[src_to_shape[v] for v in b["tail"]],
                          roll=b["roll"]))

    # --- render mesh: body faces, triangulated, split at UV seams ---
    key_to_render = {}
    render_shape, render_uv, tris = [], [], []
    for f in body_faces(obj):
        vs, ts = obj["faces"][f], obj["face_uvs"][f]
        corners = []
        for v, t in zip(vs, ts):
            k = (v, t)
            if k not in key_to_render:
                key_to_render[k] = len(render_shape)
                render_shape.append(src_to_shape[v])
                render_uv.append(obj["uvs"][t] if t >= 0 else (0.0, 0.0))
            corners.append(key_to_render[k])
        for i in range(1, len(corners) - 1):
            tris.append((corners[0], corners[i], corners[i + 1]))
    render_shape = np.array(render_shape, dtype=np.uint32)
    render_uv = np.array(render_uv, dtype=np.float32)
    index = np.array(tris, dtype=np.uint32).ravel()
    shape_tris = render_shape[index].reshape(-1, 3)  # triangles in shape space (for normals, CoR, regions)

    # --- skin weights per shape vertex (top N, renormalised) ---
    per_v = defaultdict(list)
    for bname, lst in weights.items():
        if bname not in order:
            continue
        for v, w in lst:
            if v in src_to_shape and w > 1e-4:
                per_v[src_to_shape[v]].append((w, order[bname]))
    skin_i = np.zeros((n_shape, MAX_INFLUENCES), dtype=np.uint8)
    skin_w = np.zeros((n_shape, MAX_INFLUENCES), dtype=np.float32)
    dropped = 0
    for v in range(n_shape):
        lst = sorted(per_v.get(v, [(1.0, 0)]), reverse=True)
        dropped += max(0, len(lst) - MAX_INFLUENCES)
        lst = lst[:MAX_INFLUENCES]
        tot = sum(w for w, _ in lst)
        for k, (w, b) in enumerate(lst):
            skin_i[v, k], skin_w[v, k] = b, w / tot

    # --- macro targets: dedupe, split by age level ---
    tdir = os.path.join(mh.DATA, "targets")
    rel = lambda p: os.path.relpath(p, tdir).replace(os.sep, "/")[: -len(".target.gz")]  # noqa: E731
    rels = sorted(rel(p) for p in glob.glob(os.path.join(tdir, "macrodetails", "**", "*.target.gz"), recursive=True))
    rels += sorted(rel(p) for p in glob.glob(os.path.join(tdir, "breast", "*-*-*-*-*-*.target.gz")))
    packs = {a: [] for a in ("baby", "child", "young", "old")}
    target_index = {}  # name -> [pack, id] or null when empty
    seen = {}
    for r in rels:
        i, d = mh.load_target(r)
        keep = np.array([v in src_to_shape for v in i], dtype=bool)
        if not keep.any():
            target_index[r] = None
            continue
        si = np.array([src_to_shape[v] for v in i[keep]], dtype=np.uint32)
        q = np.round(d[keep] * SCALE / QUANT).astype(np.int16)
        h = hashlib.md5(si.tobytes() + q.tobytes()).hexdigest()
        age = next(a for a in packs if f"-{a}" in r.split("/")[-1])
        if (age, h) in seen:
            target_index[r] = seen[(age, h)]
            continue
        order_i = np.argsort(si)
        packs[age].append((si[order_i], q[order_i]))
        seen[(age, h)] = [age, len(packs[age]) - 1]
        target_index[r] = seen[(age, h)]

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))

    def write_gz(name, data):
        with gzip.GzipFile(os.path.join(OUT, name + ".gz"), "wb", compresslevel=9, mtime=0) as g:
            g.write(bytes(data))

    # body.bin: a sequence of aligned arrays; offsets recorded in body.json
    arrays = [
        ("basePositions", base.astype(np.float32)),
        ("index", index.astype(np.uint32 if len(render_shape) > 65535 else np.uint16)),
        ("renderToShape", render_shape.astype(np.uint16 if n_shape <= 65535 else np.uint32)),
        ("uv", render_uv),
        ("skinIndex", skin_i),
        ("skinWeight", skin_w),
    ]
    layout, blob = {}, bytearray()
    for name, a in arrays:
        while len(blob) % 4:
            blob.append(0)
        layout[name] = dict(offset=len(blob), length=int(a.size), type=a.dtype.name)
        blob += a.tobytes()
    write_gz("body.bin", blob)

    pack_layout = {}
    for age, items in packs.items():
        # each target: uint32 count, uint32[count] indices (delta-coded as uint16 runs would be smaller,
        # but gzip on the wire already does well), int16[count*3] deltas
        b = bytearray()
        offsets = []
        for si, q in items:
            while len(b) % 4:
                b.append(0)
            offsets.append(len(b))
            b += struct.pack("<I", len(si))
            b += si.astype(np.uint32 if n_shape > 65535 else np.uint16).tobytes()
            while len(b) % 2:
                b.append(0)
            b += q.tobytes()
        write_gz(f"macro-{age}.bin", b)
        pack_layout[age] = dict(file=f"macro-{age}.bin.gz", offsets=offsets, bytes=len(b))

    meta = dict(body="body.bin.gz",
        version=FORMAT_VERSION, source="MakeHuman CC0 assets (via MPFB2 2.0.17 data)", rig=RIG,
        shapeVertexCount=n_shape, bodyVertexCount=int(len(body_v)), renderVertexCount=int(len(render_shape)),
        triangleCount=int(len(index) // 3), quant=QUANT, maxInfluences=MAX_INFLUENCES,
        indexWidth=2 if n_shape <= 65535 else 4,
        layout=layout, bones=bones, ground=[src_to_shape[v] for v in ground_vs],
        macroPacks=pack_layout, macroTargets=target_index,
    )
    json.dump(meta, open(os.path.join(OUT, "body.json"), "w"), separators=(",", ":"))
    sizes = {f: os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)}
    print(f"shape verts {n_shape}, render verts {len(render_shape)}, tris {len(index) // 3}, bones {len(bones)}, "
          f"influences dropped {dropped}")
    for f, s in sorted(sizes.items()):
        print(f"  {f:16s} {s / 1024:8.0f} KB")


if __name__ == "__main__":
    build()
