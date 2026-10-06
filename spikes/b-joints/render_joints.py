"""Spike B: how bad is linear blend skinning at the major joints, and how much do
dual-quaternion skinning and corrective shapes fix? Throwaway.

Run headless (from any directory):
  "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe" -b --factory-startup -P render_joints.py -- <out_dir> [rig]
Needs the MPFB2 extension installed in Blender's user_default repo.

Methods compared per joint and angle:
  LBS        Armature modifier, linear blend (what three.js does by default)
  DQS        Armature modifier with Preserve Volume (dual quaternion)
  LBS+CS     LBS followed by Corrective Smooth: a stand-in for what a baked
             pose-driven corrective shape can achieve (it can be baked to one)
"""
import math
import os
import sys

import addon_utils
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "spikeB_out")
RIG = argv[1] if len(argv) > 1 else "game_engine"
os.makedirs(OUT, exist_ok=True)

# --- enable MPFB2 (factory startup skips user prefs) ---
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

basemesh = HumanService.create_human(scale=0.1)
arm = HumanService.add_builtin_rig(basemesh, RIG)
arm_mod = next(m for m in basemesh.modifiers if m.type == "ARMATURE")

# Corrective smooth after the armature, and a light subdivision for render only
cs = basemesh.modifiers.new("CorrectiveSmooth", "CORRECTIVE_SMOOTH")
cs.rest_source = "ORCO"
cs.smooth_type = "LENGTH_WEIGHTED"
cs.iterations = 12
cs.factor = 0.5
cs.use_only_smooth = False
# It must run before MPFB's helper mask, which changes the vertex count
bpy.context.view_layer.objects.active = basemesh
order = [m.name for m in basemesh.modifiers]
bpy.ops.object.modifier_move_to_index(modifier=cs.name, index=order.index(arm_mod.name) + 1)
print("modifiers:", [m.type for m in basemesh.modifiers])
sub = basemesh.modifiers.new("Subsurf", "SUBSURF")
sub.levels = sub.render_levels = 1

mat = bpy.data.materials.new("clay")
mat.diffuse_color = (0.80, 0.70, 0.60, 1)
basemesh.data.materials.clear()
basemesh.data.materials.append(mat)

# --- figure axes from the rig itself ---
B = {b.name: b for b in arm.data.bones}
names = {
    "game_engine": dict(up="upperarm_r", lo="lowerarm_r", hand="hand_r", thigh="thigh_r", calf="calf_r",
                        foot="foot_r", ball="ball_r", up_l="upperarm_l"),
}[RIG]
W = arm.matrix_world
def head(n): return W @ B[names[n]].head_local
def tail(n): return W @ B[names[n]].tail_local
down = Vector((0, 0, -1))
fwd = (head("ball") - head("foot")); fwd.z = 0; fwd.normalize()
lat = head("up") - head("up_l"); lat.z = 0; lat.normalize()  # toward the figure's right side
print("forward", fwd, "lateral", lat)


def rest_dir(n):
    return (tail(n) - head(n)).normalized()


def aim(pb_name, direction):
    """Pose bone so it points along world `direction` (minimal rotation from rest)."""
    pb = arm.pose.bones[pb_name]
    pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    cur = (W @ pb.tail - W @ pb.head).normalized()
    rot = cur.rotation_difference(direction.normalized()).to_matrix().to_4x4()
    hw = W @ pb.head
    m = Matrix.Translation(hw) @ rot @ Matrix.Translation(-hw) @ (W @ pb.matrix)
    pb.matrix = W.inverted() @ m
    bpy.context.view_layer.update()


def spin(pb_name, axis, angle):
    """Rotate pose bone about a world axis through its head, on top of its current pose."""
    pb = arm.pose.bones[pb_name]
    hw = W @ pb.head
    rot = Matrix.Rotation(angle, 4, axis.normalized())
    m = Matrix.Translation(hw) @ rot @ Matrix.Translation(-hw) @ (W @ pb.matrix)
    pb.matrix = W.inverted() @ m
    bpy.context.view_layer.update()


def reset():
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def bent(base_dir, toward, deg):
    r = math.radians(deg)
    return base_dir * math.cos(r) + toward * math.sin(r)


up_rest, lo_rest = rest_dir("up"), rest_dir("lo")

# Each test: (joint label, pose function(angle), angles, camera direction, focus bone)
def shoulder(a):
    aim(names["up"], bent(down, lat, a))

def elbow(a):
    aim(names["up"], bent(down, lat, 30))
    d = (W @ arm.pose.bones[names["up"]].tail - W @ arm.pose.bones[names["up"]].head).normalized()
    aim(names["lo"], bent(d, fwd, a))

def wrist(a):
    aim(names["up"], bent(down, lat, 10))
    aim(names["lo"], bent(down, lat, 10))
    d = (W @ arm.pose.bones[names["lo"]].tail - W @ arm.pose.bones[names["lo"]].head).normalized()
    if a == "twist90":
        spin(names["hand"], d, math.radians(90))
    else:
        aim(names["hand"], bent(d, lat, a))  # + = bend outward/back, - = inward/palmward

def hip(a):
    aim(names["up"], bent(down, lat, 40))  # keep the hand off the thigh
    aim(names["thigh"], bent(down, fwd, a))

def knee(a):
    aim(names["thigh"], bent(down, fwd, 30))
    d = (W @ arm.pose.bones[names["thigh"]].tail - W @ arm.pose.bones[names["thigh"]].head).normalized()
    aim(names["calf"], bent(d, -fwd, a))

TESTS = [
    ("shoulder", shoulder, [0, 90, 170], fwd * 1.0 + lat * 0.7 + Vector((0, 0, 0.25)), "up", "head", 0.75),
    ("elbow", elbow, [45, 100, 145], lat * 1.0 + fwd * 0.6, "lo", "head", 0.32),
    ("wrist", wrist, [-70, 60, "twist90"], fwd * 1.0 + lat * 0.4, "hand", "head", 0.24),
    ("hip", hip, [45, 90, 120], lat * 1.0 + fwd * 0.5 + Vector((0, 0, 0.1)), "thigh", "head", 0.7),
    ("knee", knee, [45, 100, 150], lat * 1.0 + fwd * 0.2, "calf", "head", 0.5),
]
METHODS = [("LBS", False, False), ("DQS", True, False), ("LBS+CS", False, True)]

# --- render setup: Workbench, studio light, cavity, shadows ---
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "MATERIAL"
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.show_shadows = True
sh.show_specular_highlight = True
scene.render.resolution_x = scene.render.resolution_y = 480
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w") if not scene.world else scene.world
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def frame(view_dir, focus, ortho):
    cam_data.ortho_scale = ortho
    v = view_dir.normalized()
    cam.location = focus + v * 3
    cam.rotation_euler = (-v).to_track_quat("-Z", "Y").to_euler()


for label, fn, angles, view, bone_key, end, ortho in TESTS:
    for a in angles:
        reset()
        fn(a)
        pb = arm.pose.bones[names[bone_key]]
        focus = W @ pb.head
        for mname, dq, use_cs in METHODS:
            arm_mod.use_deform_preserve_volume = dq
            cs.show_render = cs.show_viewport = use_cs
            frame(view, focus, ortho)
            scene.render.filepath = os.path.join(OUT, f"{label}_{a}_{mname}.png")
            bpy.ops.render.render(write_still=True)
        print(f"rendered {label} {a}")

# rest pose reference
reset()
arm_mod.use_deform_preserve_volume = False
cs.show_render = False
frame(fwd, (head("up") + head("up_l")) / 2 + Vector((0, 0, -0.6)), 2.0)
scene.render.filepath = os.path.join(OUT, "rest.png")
bpy.ops.render.render(write_still=True)
print("done", OUT)
