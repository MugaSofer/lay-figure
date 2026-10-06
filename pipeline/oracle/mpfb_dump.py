"""Black-box oracle: ask MPFB (in Blender) for bodies at given macro settings and dump their vertices.
Used only to test our own macro implementation; nothing from here ships.

  blender -b --factory-startup -P mpfb_dump.py -- <settings.json> <out.npz>
"""
import json
import sys

import addon_utils
import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
settings_list = json.load(open(argv[0]))
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

out = []
for s in settings_list:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    info = TargetService.get_default_macro_info_dict()
    info.update({k: v for k, v in s.items() if k != "race"})
    if "race" in s:
        info["race"] = s["race"]
    h = HumanService.create_human(scale=0.1, feet_on_ground=False, macro_detail_dict=info)
    for m in h.modifiers:
        m.show_viewport = False
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = h.evaluated_get(deps).to_mesh()
    co = np.array([v.co[:] for v in ev.vertices], dtype=np.float64)
    h.evaluated_get(deps).to_mesh_clear()
    out.append(co)
np.savez(argv[1], coords=np.array(out))
print("dumped", len(out))
