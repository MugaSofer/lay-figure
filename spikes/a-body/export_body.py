"""Spike A: export the MakeHuman (CC0) body from MPFB2 as glTF with a skeleton and 20+ morph targets.
Throwaway.

  "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe" -b --factory-startup -P export_body.py -- <out.glb> [--normals]
"""
import os
import sys

import addon_utils
import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "body.glb")
NORMALS = "--normals" in argv

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

TARGETS_DIR = os.path.join(os.path.dirname(sys.modules["bl_ext.user_default.mpfb"].__file__), "data", "targets")
# Deliberately overlapping regions so stacking is exercised
TARGETS = [
    "arms/r-upperarm-fat-incr", "arms/l-upperarm-fat-incr", "arms/r-upperarm-muscle-incr", "arms/l-upperarm-muscle-incr",
    "arms/r-lowerarm-fat-incr", "arms/l-lowerarm-fat-incr", "arms/measure-upperarm-length-incr",
    "legs/r-upperleg-fat-incr", "legs/l-upperleg-fat-incr", "legs/r-upperleg-muscle-incr", "legs/l-upperleg-muscle-incr",
    "legs/r-lowerleg-fat-incr", "legs/l-lowerleg-fat-incr",
    "hip/hip-scale-horiz-incr", "hip/hip-waist-up", "stomach/stomach-pregnant-incr",
    "breast/breast-volume-vert-up", "breast/breast-trans-down", "buttocks/buttocks-volume-incr",
    "torso/torso-scale-horiz-incr", "neck/neck-scale-horiz-incr",
    "head/head-fat-incr", "head/head-age-incr", "head/head-oval",
]
# Macro presets: MPFB evaluates MakeHuman's (non-linear) macro blend for each, and we store each
# result as one dense shape relative to the default body. Blending presets linearly only
# approximates MakeHuman's macro maths; fine for judging the body, not for the real app.
PRESETS = {
    "female": {"gender": 0.0}, "male": {"gender": 1.0},
    "heavy": {"weight": 1.0}, "slim": {"weight": 0.0},
    "muscular": {"muscle": 1.0}, "soft": {"muscle": 0.0},
    "older": {"age": 0.875}, "tall": {"height": 1.0}, "short": {"height": 0.0},
    "idealised": {"proportions": 1.0}, "larger-cup": {"cupsize": 1.0},
}

from bl_ext.user_default.mpfb.services.targetservice import TargetService as _TS  # noqa: E402


def body_coords(macros):
    """Vertex coordinates of a fresh human with the given macro settings, shape keys mixed in."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    info = _TS.get_default_macro_info_dict()
    info.update(macros)
    h = HumanService.create_human(scale=0.1, macro_detail_dict=info)
    deps = bpy.context.evaluated_depsgraph_get()
    for m in h.modifiers:
        m.show_viewport = False
    bpy.context.view_layer.update()
    ev = h.evaluated_get(deps).to_mesh()
    co = [v.co.copy() for v in ev.vertices]
    h.evaluated_get(deps).to_mesh_clear()
    return co


default_co = body_coords({})
preset_co = {name: body_coords(m) for name, m in PRESETS.items()}

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
basemesh = HumanService.create_human(scale=0.1)
bpy.context.view_layer.objects.active = basemesh
basemesh.select_set(True)
if basemesh.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)  # bake the default body into the base

basemesh.shape_key_add(name="Basis", from_mix=False)
loaded = []
for t in TARGETS:
    path = os.path.join(TARGETS_DIR, t + ".target.gz")
    if not os.path.exists(path):
        print("MISSING target", t)
        continue
    TargetService.load_target(basemesh, path, weight=0.0, name=t.split("/")[-1])
    loaded.append(t)
for name, co in preset_co.items():
    key = basemesh.shape_key_add(name=name, from_mix=False)
    for i, (d, c) in enumerate(zip(default_co, co)):
        key.data[i].co = basemesh.data.shape_keys.key_blocks["Basis"].data[i].co + (c - d)
    key.value = 0.0
print("loaded", len(loaded), "targets and", len(preset_co), "presets")

arm = HumanService.add_builtin_rig(basemesh, "game_engine")

# Delete helper geometry (MPFB only masks it); shape keys follow the deletion
mask = next(m for m in basemesh.modifiers if m.type == "MASK")
vg = basemesh.vertex_groups[mask.vertex_group]
keep_in_group = not mask.invert_vertex_group
bm = bmesh.new()
bm.from_mesh(basemesh.data)
deform = bm.verts.layers.deform.active
doomed = [v for v in bm.verts if (vg.index in v[deform]) != keep_in_group]
bmesh.ops.delete(bm, geom=doomed, context="VERTS")
bm.to_mesh(basemesh.data)
bm.free()
basemesh.modifiers.remove(mask)
print("vertices after helper removal:", len(basemesh.data.vertices))

# Keep only deform-weight groups so the exporter doesn't carry dozens of helper groups
bone_names = {b.name for b in arm.data.bones}
for g in list(basemesh.vertex_groups):
    if g.name not in bone_names:
        basemesh.vertex_groups.remove(g)

bpy.ops.object.select_all(action="DESELECT")
basemesh.select_set(True)
arm.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True,
    export_skins=True, export_morph=True, export_morph_normal=NORMALS, export_morph_tangent=False,
    export_apply=False, export_materials="NONE", export_animations=False,
)
print("exported", OUT, os.path.getsize(OUT), "bytes")
