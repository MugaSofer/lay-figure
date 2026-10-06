// Capsules fitted to the mesh around each bone, rebuilt with the shape. Used for keeping IK targets and
// elbows out of the body now, and as the basis for collision later (M4).
import { Vector3 } from 'three';
import type { Figure } from '../body/figure';

export interface Capsule { bone: number; radius: number; a: Vector3; b: Vector3 } // a, b in world space (posed)

const tmp = new Vector3(), ab = new Vector3();

export function segmentDistance(p: Vector3, a: Vector3, b: Vector3) {
  ab.subVectors(b, a);
  const t = Math.min(1, Math.max(0, tmp.subVectors(p, a).dot(ab) / (ab.lengthSq() || 1)));
  return tmp.copy(a).addScaledVector(ab, t).distanceTo(p);
}

/** Per-bone radius: a percentile of the distances from the bone's own vertices to its axis (rest pose). */
export function fitRadii(fig: Figure, percentile = 0.6): number[] {
  const { data, rests } = fig;
  const inf = data.meta.maxInfluences, pos = fig.shapePositions;
  const dists: number[][] = rests.map(() => []);
  const p = new Vector3();
  for (let v = 0; v < data.meta.bodyVertexCount; v++) {
    if (data.skinWeight[v * inf] < 0.6) continue; // only vertices mostly owned by one bone
    const b = data.skinIndex[v * inf];
    p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    dists[b].push(segmentDistance(p, rests[b].head, rests[b].tail));
  }
  return dists.map(d => {
    if (d.length < 8) return 0;
    d.sort((x, y) => x - y);
    return d[Math.floor(d.length * percentile)];
  });
}

/** Posed capsules for the given bones. */
export function capsules(fig: Figure, radii: number[], bones: number[]): Capsule[] {
  return bones.filter(b => radii[b] > 0).map(b => {
    const bone = fig.bones[b];
    const a = bone.getWorldPosition(new Vector3());
    const len = fig.rests[b].length;
    const bb = new Vector3(0, len, 0).applyMatrix4(bone.matrixWorld);
    return { bone: b, radius: radii[b], a, b: bb };
  });
}

/** Signed distance to the union of capsules (negative inside). */
export function sdf(p: Vector3, caps: Capsule[]) {
  let d = Infinity;
  for (const c of caps) d = Math.min(d, segmentDistance(p, c.a, c.b) - c.radius);
  return d;
}
