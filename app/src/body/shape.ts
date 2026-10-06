// Body shaping on the CPU: base shape + weighted targets -> shape-space positions, then normals and
// bone rest frames derived from that shape. Shape space and the render mesh are described in
// pipeline/lay_pipeline/build_body.py.
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BodyData, BoneSpec, Target } from './assets';

/** positions = base + sum(weight * target), all in shape space. */
export function applyTargets(data: BodyData, targets: [Target, number][], out: Float32Array = new Float32Array(data.basePositions)) {
  out.set(data.basePositions);
  const q = data.meta.quant;
  for (const [t, w] of targets) {
    const s = w * q, idx = t.indices, d = t.deltas;
    for (let k = 0; k < idx.length; k++) {
      const v = idx[k] * 3, j = k * 3;
      out[v] += d[j] * s;
      out[v + 1] += d[j + 1] * s;
      out[v + 2] += d[j + 2] * s;
    }
  }
  return out;
}

/** Shape-space triangles (render triangles mapped through renderToShape), computed once. */
export function shapeTriangles(data: BodyData) {
  const { index, renderToShape } = data;
  const tris = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) tris[i] = renderToShape[index[i]];
  return tris;
}

/** Area-weighted vertex normals in shape space, so UV seams share one normal. */
export function shapeNormals(pos: Float32Array, tris: Uint32Array, out: Float32Array = new Float32Array(pos.length)) {
  out.fill(0);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { out[v] += nx; out[v + 1] += ny; out[v + 2] += nz; }
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v], out[v + 1], out[v + 2]) || 1;
    out[v] /= l; out[v + 1] /= l; out[v + 2] /= l;
  }
  return out;
}

function mean(pos: Float32Array, idx: number[], out = new Vector3()) {
  out.set(0, 0, 0);
  for (const i of idx) out.x += pos[i * 3], out.y += pos[i * 3 + 1], out.z += pos[i * 3 + 2];
  return out.multiplyScalar(1 / idx.length);
}

// MakeHuman's rig rolls are Blender rolls, defined in Blender's Z-up frame. C maps Blender
// coordinates to ours (Y-up): (x, y, z)_ours = (x, z, -y)_blender.
const C = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const Cinv = C.clone().invert();
const Y = new Vector3(0, 1, 0);

/** World rotation of a bone at rest: local +Y runs head to tail; roll sets the twist, as Blender does.
 *  The Blender matrix maps the bone's local axes into Blender's world; C then maps that into ours.
 *  (The bone's local axes are its own, so this is C * M, not a change of basis C * M * C^-1.) */
export function boneRestRotation(head: Vector3, tail: Vector3, roll: number) {
  const dirB = tail.clone().sub(head).applyMatrix4(Cinv).normalize(); // in Blender's frame
  const align = new Quaternion().setFromUnitVectors(Y, dirB);
  const rollQ = new Quaternion().setFromAxisAngle(dirB, roll);
  const mB = new Matrix4().makeRotationFromQuaternion(rollQ.multiply(align));
  return new Quaternion().setFromRotationMatrix(C.clone().multiply(mB));
}

export interface BoneRest { head: Vector3; tail: Vector3; rotation: Quaternion; length: number }

export function boneRests(pos: Float32Array, bones: BoneSpec[]): BoneRest[] {
  return bones.map(b => {
    const head = mean(pos, b.head), tail = mean(pos, b.tail);
    return { head, tail, rotation: boneRestRotation(head, tail, b.roll), length: head.distanceTo(tail) };
  });
}

/** Height of the floor under this body (MakeHuman's ground helper). */
export function groundY(pos: Float32Array, ground: number[]) {
  return mean(pos, ground).y;
}
