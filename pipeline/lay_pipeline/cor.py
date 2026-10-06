"""Optimized Centers of Rotation (Le & Hodgins, SIGGRAPH 2016): per-vertex centres of rotation.

Each vertex's centre is the area-weighted average of triangle centroids, weighted by how similar each
triangle's bone weights are to the vertex's. Vertices with a single influence don't need one.
Chosen in Phase 0 (review/phase0/REPORT.md, section B).
"""
import numpy as np

SIGMA = 0.1


def centres(verts, weights, tris):
    """verts (V,3), weights (V,B) normalised, tris (T,3) vertex indices. Returns (V,3) and a has-centre mask."""
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    centre = (a + b + c) / 3
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    tw = (weights[tris[:, 0]] + weights[tris[:, 1]] + weights[tris[:, 2]]) / 3
    out = verts.copy()
    has = np.zeros(len(verts), bool)
    for i in range(len(verts)):
        bones = np.nonzero(weights[i] > 1e-4)[0]
        if len(bones) < 2:
            continue
        wi = weights[i, bones]
        wt = tw[:, bones]
        rel = (wt > 1e-4).sum(1) >= 2
        if not rel.any():
            continue
        wt = wt[rel]
        s = np.zeros(len(wt))
        for p in range(len(bones)):
            for q in range(p + 1, len(bones)):
                d = wi[p] * wt[:, q] - wi[q] * wt[:, p]
                s += 2 * wi[p] * wi[q] * wt[:, p] * wt[:, q] * np.exp(-(d * d) / (SIGMA * SIGMA))
        sa = s * area[rel]
        tot = sa.sum()
        if tot > 1e-12:
            out[i] = (sa[:, None] * centre[rel]).sum(0) / tot
            has[i] = True
    return out, has
