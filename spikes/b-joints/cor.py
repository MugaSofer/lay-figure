"""Optimized Centers of Rotation skinning (Le & Hodgins, SIGGRAPH 2016), in numpy. Spike only.

Precompute: each vertex gets a centre of rotation p*, the area-weighted average of triangle centroids,
weighted by how similar each triangle's bone weights are to the vertex's.
Deform: v' = R(q)(v - p*) + LBS(p*), where q is the weight-blended bone rotation (QLERP).
"""
import numpy as np

SIGMA = 0.1


def precompute(verts, weights, face_centers, face_areas, face_weights):
    """verts (V,3), weights (V,B) normalised, faces given by centre (F,3), area (F,), weights (F,B)."""
    V = len(verts)
    cor = verts.copy()
    has = np.zeros(V, bool)
    for i in range(V):
        bones = np.nonzero(weights[i] > 1e-4)[0]
        if len(bones) < 2:
            continue  # one bone: any centre gives the same result
        wi = weights[i, bones]
        wt = face_weights[:, bones]
        rel = (wt > 1e-4).sum(1) >= 2
        if not rel.any():
            continue
        wt = wt[rel]
        s = np.zeros(len(wt))
        for a in range(len(bones)):
            for b in range(a + 1, len(bones)):
                d = wi[a] * wt[:, b] - wi[b] * wt[:, a]
                s += 2 * wi[a] * wi[b] * wt[:, a] * wt[:, b] * np.exp(-(d * d) / (SIGMA * SIGMA))
        sa = s * face_areas[rel]
        tot = sa.sum()
        if tot > 1e-12:
            cor[i] = (sa[:, None] * face_centers[rel]).sum(0) / tot
            has[i] = True
    return cor, has


def mat_to_quat(m):
    """Rotation matrices (N,3,3) -> quaternions (N,4) as w,x,y,z."""
    q = np.empty((len(m), 4))
    for n, r in enumerate(m):
        t = np.trace(r)
        if t > 0:
            s = np.sqrt(t + 1.0) * 2
            q[n] = [0.25 * s, (r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s]
        else:
            k = int(np.argmax(np.diag(r)))
            if k == 0:
                s = np.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
                q[n] = [(r[2, 1] - r[1, 2]) / s, 0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s]
            elif k == 1:
                s = np.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
                q[n] = [(r[0, 2] - r[2, 0]) / s, (r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s]
            else:
                s = np.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
                q[n] = [(r[1, 0] - r[0, 1]) / s, (r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s]
    return q


def quat_to_mat(q):
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    return np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], -1),
        np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], -1),
        np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1),
    ], -2)


def lbs(points, weights, mats):
    """points (V,3), weights (V,B), mats (B,4,4) -> (V,3)."""
    h = np.concatenate([points, np.ones((len(points), 1))], 1)
    per_bone = np.einsum("bij,vj->vbi", mats, h)[..., :3]  # (V,B,3)
    return np.einsum("vb,vbi->vi", weights, per_bone)


def deform_cor(verts, weights, mats, cor):
    quats = mat_to_quat(mats[:, :3, :3])  # (B,4)
    dom = np.argmax(weights, 1)
    sign = np.sign(np.einsum("vb,vb->vb", np.ones_like(weights), (quats[None] * quats[dom][:, None]).sum(-1)))
    sign[sign == 0] = 1
    q = np.einsum("vb,vbk->vk", weights * sign, np.broadcast_to(quats, (len(verts),) + quats.shape))
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    R = quat_to_mat(q)
    return np.einsum("vij,vj->vi", R, verts - cor) + lbs(cor, weights, mats)
