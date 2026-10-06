"""Check our bone rest-frame rule (minimal rotation from +Y to the bone, then the rig file's Blender roll)
against the bone matrices MPFB builds in Blender for the game_engine rig. Black-box check; nothing ships.

  blender -b --factory-startup -P bone_frames.py
"""
import json
import os

import addon_utils
import bpy
from mathutils import Quaternion, Vector

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
rig = json.load(open(os.path.join(HERE, "..", "..", "assets-src", "mpfb2-2.0.17", "src", "mpfb", "data", "rigs", "standard",
                                  "rig.game_engine.json")))
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
h = HumanService.create_human(scale=0.1)
arm = HumanService.add_builtin_rig(h, "game_engine")
worst, bad = 0.0, []
for b in arm.data.bones:
    d = (b.tail_local - b.head_local).normalized()
    ours = Quaternion(d, rig[b.name].get("roll", 0.0)) @ Vector((0, 1, 0)).rotation_difference(d)
    err = ours.rotation_difference(b.matrix_local.to_quaternion()).angle
    worst = max(worst, err)
    if err > 1e-3:
        bad.append(f"{b.name} {err * 57.2958:.2f}")
print("mismatched:", bad[:20])
print(f"worst {worst * 57.2958:.4f} deg over {len(arm.data.bones)} bones")
