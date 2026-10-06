"""Spike B, extended set: compound poses (close to the brief's regression scenes), several views each.
Imported by render_joints.py when run with the "ext" set; `k` carries its helpers."""
import math

from mathutils import Vector


def build(k):
    aim, spin, bent, arm, W = k["aim"], k["spin"], k["bent"], k["arm"], k["W"]
    fwd, lat, down = k["fwd"], k["lat"], k["down"]
    up = -down

    def n(v):
        return v.normalized()

    def pos(bone, end="head"):
        pb = arm.pose.bones[bone]
        return W @ (pb.head if end == "head" else pb.tail)

    def aim_hinged(parent, child, pdir, cdir, bend_rest):
        """Aim parent, then twist it about its own axis so the child's hinge bends toward cdir
        in the plane it bends in at rest (bend_rest), then aim the child. Keeps knees/elbows hinge-like."""
        aim(parent, pdir)
        pb = arm.pose.bones[parent]
        rq = (W @ pb.matrix).to_quaternion() @ (W @ pb.bone.matrix_local).to_quaternion().inverted()
        t = n(pdir)
        b = rq @ bend_rest
        bp = b - t * b.dot(t)
        cp = cdir - t * cdir.dot(t)
        if bp.length > 1e-6 and cp.length > 1e-6:
            bp.normalize()
            cp.normalize()
            spin(parent, t, math.atan2(t.dot(bp.cross(cp)), bp.dot(cp)))
        aim(child, cdir)

    def mirror(v):
        return v - 2 * lat * v.dot(lat)

    def arms_overhead():
        for s, side in ((1, "r"), (-1, "l")):
            d = n(up * 0.95 + lat * 0.22 * s + fwd * 0.1)
            aim_hinged(f"upperarm_{side}", f"lowerarm_{side}", d, n(d + fwd * 0.15), fwd)

    def reach_forward():
        aim_hinged("upperarm_r", "lowerarm_r", n(fwd + up * 0.1), n(fwd + up * 0.15), fwd)

    def arms_crossed():
        aim_hinged("upperarm_r", "lowerarm_r", n(down * 0.7 + fwd * 0.55 - lat * 0.2), n(-lat + fwd * 0.12 + up * 0.18), fwd)
        aim_hinged("upperarm_l", "lowerarm_l", n(down * 0.7 + fwd * 0.62 + lat * 0.2), n(lat + fwd * 0.3 + up * 0.05), fwd)

    def hand_on_hip():
        aim("upperarm_r", n(lat * 0.65 + down * 0.7 - fwd * 0.3))
        hip = pos("thigh_r") + lat * 0.13 + up * 0.1
        aim_hinged("upperarm_r", "lowerarm_r", n(lat * 0.65 + down * 0.7 - fwd * 0.3), n(hip - pos("lowerarm_r")), fwd)

    def upperarm_twist(deg):
        def f():
            aim_hinged("upperarm_r", "lowerarm_r", lat, fwd, fwd)
            spin("upperarm_r", lat, math.radians(deg))
        return f

    def deep_crouch():
        for s, side in ((1, "r"), (-1, "l")):
            t = n(fwd * 0.82 + up * 0.38 + lat * 0.22 * s)
            aim_hinged(f"thigh_{side}", f"calf_{side}", t, n(down * 0.75 - fwd * 0.6 + lat * 0.05 * s), -fwd)
        aim("spine_01", n(up + fwd * 0.35))

    def cross_legged():
        for s, side, cross in ((1, "r", -1), (-1, "l", 1)):
            t = n(fwd * 0.75 + lat * 0.6 * s + down * 0.08)
            aim_hinged(f"thigh_{side}", f"calf_{side}", t, n(lat * 0.9 * cross + fwd * (0.25 if s > 0 else 0.4) + down * 0.12), -fwd)

    def leg_side():
        aim("thigh_r", bent(down, lat, 60))

    def leg_back():
        aim_hinged("thigh_r", "calf_r", bent(down, -fwd, 35), bent(down, -fwd, 50), -fwd)

    def forward_bend():
        for bone, a in (("spine_01", 25), ("spine_02", 50), ("spine_03", 70)):
            aim(bone, bent(up, fwd, a))

    def twist_sidebend():
        for bone, a in (("spine_01", 10), ("spine_02", 20), ("spine_03", 30)):
            aim(bone, bent(up, -lat, a))
            spin(bone, n(pos(bone, "tail") - pos(bone)), math.radians(15))

    def head_turn():
        aim("neck_01", bent(up, fwd, 15))
        spin("neck_01", n(pos("neck_01", "tail") - pos("neck_01")), math.radians(30))
        spin("head", n(pos("head", "tail") - pos("head")), math.radians(40))

    def elbow_deep():
        aim_hinged("upperarm_r", "lowerarm_r", bent(down, lat, 20), n(up * 0.75 + fwd * 0.55 - lat * 0.1), fwd)

    def wrist_ext():
        aim_hinged("upperarm_r", "lowerarm_r", bent(down, lat, 10), fwd, fwd)
        aim("hand_r", bent(fwd, up, 70))

    F, B_, S = fwd, -fwd, lat
    tq = n(fwd + lat)
    shoulders = lambda: (pos("upperarm_r") + pos("upperarm_l")) / 2  # noqa: E731
    return [
        # name, pose fn, [(view name, dir)], focus fn, ortho
        ("arms_overhead", arms_overhead, [("front", F), ("back", B_), ("side", S)], lambda: shoulders() + up * 0.05, 0.8),
        ("reach_forward", reach_forward, [("3q-front", tq), ("side", S), ("3q-back", n(B_ + lat))], lambda: pos("upperarm_r"), 0.6),
        ("arms_crossed", arms_crossed, [("front", F), ("3q-front", tq), ("above", n(F + up * 1.3))], lambda: pos("spine_03") + fwd * 0.12, 0.75),
        ("hand_on_hip", hand_on_hip, [("front", F), ("back", B_), ("side", S)], lambda: pos("lowerarm_r"), 0.75),
        ("arm_twist_in", upperarm_twist(-60), [("front", F), ("above", n(up + fwd * 0.3)), ("back", B_)], lambda: pos("upperarm_r") + lat * 0.12, 0.6),
        ("arm_twist_out", upperarm_twist(60), [("front", F), ("above", n(up + fwd * 0.3)), ("back", B_)], lambda: pos("upperarm_r") + lat * 0.12, 0.6),
        ("deep_crouch", deep_crouch, [("side", S), ("front", F), ("back", B_)], lambda: pos("thigh_r") + fwd * 0.15, 1.0),
        ("cross_legged", cross_legged, [("front", F), ("above-front", n(F + up)), ("side", S)], lambda: pos("pelvis") + fwd * 0.2, 1.0),
        ("leg_side", leg_side, [("front", F), ("back", B_), ("3q-front", tq)], lambda: pos("pelvis") + lat * 0.1 + down * 0.1, 0.8),
        ("leg_back", leg_back, [("side", S), ("3q-back", n(B_ + lat)), ("back", B_)], lambda: pos("thigh_r") + down * 0.1, 0.8),
        ("forward_bend", forward_bend, [("side", S), ("front", F), ("back", B_)], lambda: pos("spine_01"), 0.9),
        ("twist_sidebend", twist_sidebend, [("front", F), ("back", B_), ("side", S)], lambda: pos("spine_02"), 0.9),
        ("head_turn", head_turn, [("front", F), ("side", S), ("3q-back", n(B_ + lat))], lambda: pos("neck_01") + up * 0.06, 0.4),
        ("elbow_deep", elbow_deep, [("inner", n(fwd - lat * 0.4 + up * 0.3)), ("behind", n(B_ + lat * 0.3)), ("side", S)], lambda: pos("lowerarm_r"), 0.4),
        ("wrist_ext", wrist_ext, [("side", S), ("above", n(up + lat * 0.2)), ("3q-front", tq)], lambda: pos("hand_r"), 0.3),
    ]
