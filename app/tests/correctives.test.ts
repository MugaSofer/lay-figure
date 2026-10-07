import { Matrix4, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Figure } from '../src/body/figure';
import { adjacency, corrective, prepareRest, skinCoR } from '../src/body/correctives';
import { shapeTriangles } from '../src/body/shape';
import { PoseRig } from '../src/pose/rig';
import { makeFigure } from './helpers';

let fig: Figure;
beforeAll(async () => { fig = await makeFigure(); }, 30000);

function skinMats(f: Figure) {
  f.group.updateMatrixWorld(true);
  const sk = f.mesh.skeleton, out = new Float32Array(sk.bones.length * 16), m = new Matrix4();
  sk.bones.forEach((b, i) => { m.multiplyMatrices(b.matrixWorld, sk.boneInverses[i]); out.set(m.elements, i * 16); });
  return out;
}

function bake(f: Figure) {
  const n = f.data.meta.bodyVertexCount, tris = shapeTriangles(f.data), adj = adjacency(tris, n);
  const rest = f.shapePositions, prep = prepareRest(rest, tris, adj, n);
  const posed = new Float32Array(rest.length), rots = new Float32Array(rest.length / 3 * 4);
  skinCoR(rest, n, f.data.skinIndex, f.data.skinWeight, f.data.meta.maxInfluences, f.corShape, skinMats(f), posed, rots);
  return { delta: corrective(posed, rots, prep, tris, adj, n), posed };
}
const maxLen = (d: Float32Array) => { let m = 0; for (let i = 0; i < d.length; i += 3) m = Math.max(m, Math.hypot(d[i], d[i + 1], d[i + 2])); return m; };

describe('corrective shapes', () => {
  it('are empty at rest', () => {
    fig.resetPose();
    const { delta, posed } = bake(fig);
    let err = 0;
    for (let i = 0; i < fig.data.meta.bodyVertexCount * 3; i++) err = Math.max(err, Math.abs(posed[i] - fig.shapePositions[i]));
    expect(err).toBeLessThan(1e-5); // CPU CoR skinning at rest is the identity
    expect(delta.indices.length).toBe(0);
  });
  it('are (nearly) empty for a rigid turn of the whole body', () => {
    fig.resetPose();
    fig.joints[0].setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), 1.1);
    fig.applyPose();
    expect(maxLen(bake(fig).delta.deltas)).toBeLessThan(5e-4);
  });
  it('are substantial where a bent joint collapses, and limited to that region', () => {
    fig.resetPose();
    const rig = new PoseRig(fig);
    const elbow = fig.boneIndex.get('lowerarm_l')!;
    rig.setJoint(elbow, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.9));
    const { delta } = bake(fig);
    expect(maxLen(delta.deltas)).toBeGreaterThan(0.003); // millimetres of correction at the elbow
    // everything corrected is skinned to the arm's bones
    const arm = new Set(['upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_l'].map(b => fig.boneIndex.get(b)!));
    const inf = fig.data.meta.maxInfluences;
    let outside = 0;
    for (const v of delta.indices) {
      let w = 0;
      for (let k = 0; k < inf; k++) if (arm.has(fig.data.skinIndex[v * inf + k])) w += fig.data.skinWeight[v * inf + k];
      if (w < 0.05) outside++;
    }
    expect(outside / delta.indices.length).toBeLessThan(0.05);
  });
});
