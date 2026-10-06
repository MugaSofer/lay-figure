"""Spike A follow-up: MakeHuman default body vs Meta MHR (lod1), same clay render. Throwaway.

  blender -b --factory-startup -P compare_mhr.py -- <mhr lod fbx> <out_dir>
"""
import os
import sys

import addon_utils
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
FBX, OUT = argv[0], os.path.abspath(argv[1])
os.makedirs(OUT, exist_ok=True)

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

mh = HumanService.create_human(scale=0.1)
sub = mh.modifiers.new("Subsurf", "SUBSURF")
sub.levels = sub.render_levels = 1

before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=FBX)
mhr_meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
for o in bpy.data.objects:
    if o not in before and o.type == "ARMATURE":
        o.hide_render = True


def bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


bpy.context.view_layer.update()
lo, hi = bbox(mhr_meshes)
print("MHR bbox", lo, hi, "verts", sum(len(o.data.vertices) for o in mhr_meshes),
      "faces", sum(len(o.data.polygons) for o in mhr_meshes))
# Normalise MHR to MakeHuman's height and stand it on the ground beside it
mlo, mhi = bbox([mh])
h_mh, h_mhr = (mhi.z - mlo.z), max(hi.z - lo.z, hi.y - lo.y)
print("heights (bbox) MakeHuman", h_mh, "MHR", h_mhr)
root = bpy.data.objects.new("mhr_root", None)
bpy.context.scene.collection.objects.link(root)
for o in bpy.data.objects:
    if o not in before and o.parent is None and o != root:
        o.parent = root
bpy.context.view_layer.update()
lo, hi = bbox(mhr_meshes)
if (hi.y - lo.y) > (hi.z - lo.z) * 1.5:  # Y-up file lying down: stand it up
    root.rotation_euler = (1.5708, 0, 0)
    bpy.context.view_layer.update()
    lo, hi = bbox(mhr_meshes)
s = h_mh / (hi.z - lo.z)
root.scale = (s, s, s)
bpy.context.view_layer.update()
lo, hi = bbox(mhr_meshes)
root.location += Vector((0.7 - (lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
mh.location.x -= 0.0
bpy.context.view_layer.update()

mat = bpy.data.materials.new("clay")
mat.diffuse_color = (0.80, 0.70, 0.60, 1)
for o in [mh] + mhr_meshes:
    o.data.materials.clear()
    o.data.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "MATERIAL"
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.show_shadows = True
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def shot(name, focus, view, ortho, w=900, h=900):
    scene.render.resolution_x, scene.render.resolution_y = w, h
    cam_data.ortho_scale = ortho
    v = view.normalized()
    cam.location = focus + v * 5
    cam.rotation_euler = (-v).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)


mid = Vector((0.35, 0, h_mh / 2))
shot("front", mid, Vector((0, -1, 0)), 2.0, 1000, 1000)
shot("side", mid, Vector((1, 0, 0)), 2.0, 1000, 1000)
shot("three_quarter", mid, Vector((0.6, -1, 0.1)), 2.0, 1000, 1000)
shot("feet", Vector((0.35, -0.05, 0.08)), Vector((0.3, -1, 0.5)), 0.9, 1000, 500)
shot("torso", Vector((0.35, 0, h_mh * 0.6)), Vector((0, -1, 0)), 1.1, 1000, 700)
print("done")
