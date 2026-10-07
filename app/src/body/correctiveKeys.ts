// Key poses for corrective shapes, and how the live pose blends between them.
//
// Each key poses one joint (the shoulder keys also move the collarbone as the shoulder rhythm would) and
// records that joint's swing as a rotation vector in its rest frame. At run time each joint's current
// swing picks a mix of its keys by radial-basis interpolation over those vectors, with the rest pose as
// an extra centre that means "no correction".
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Figure } from './figure';
import { clampJoint, swingTwist } from '../pose/limits';
import type { PoseRig } from '../pose/rig';

export interface KeyPose { name: string; joint: number; centre: Vector3 }

const Y = new Vector3(0, 1, 0);
const DEG = Math.PI / 180;
const SIGMA = 0.9; // RBF width (radians of swing)

/** Swing of joint rotation q as a rotation vector (axis * angle), twist removed. */
export function swingVector(q: Quaternion) {
  const { swing } = swingTwist(q);
  if (swing.w < 0) swing.set(-swing.x, -swing.y, -swing.z, -swing.w);
  const half = Math.acos(Math.min(1, swing.w)), s = Math.sin(half);
  return s < 1e-6 ? new Vector3() : new Vector3(swing.x, swing.y, swing.z).multiplyScalar((2 * half) / s);
}

type Poser = (rig: PoseRig, side: 'l' | 'r') => number; // poses the figure, returns the driver joint

/** Aim the upper arm along a body direction (figure faces +Z, its left is +X) with the shoulder rhythm. */
const armAim = (dir: (out: number) => Vector3): Poser => (rig, side) => {
  const limb = rig.arms[side], out = side === 'l' ? 1 : -1;
  const d = dir(out).normalize();
  if (limb.clavicle !== undefined) rig.applyShoulderRhythm(limb.clavicle, d);
  rig.fig.group.updateMatrixWorld(true);
  rig.aim(limb.upper, rig.worldPos(limb.upper).add(d));
  return limb.upper;
};
const thighAim = (dir: (out: number) => Vector3): Poser => (rig, side) => {
  const limb = rig.legs[side], out = side === 'l' ? 1 : -1;
  rig.fig.group.updateMatrixWorld(true);
  rig.aim(limb.upper, rig.worldPos(limb.upper).add(dir(out).normalize()));
  return limb.upper;
};
/** Bend a hinge (elbow, knee) by deg from straight, in the plane its limit flexes in. */
const hinge = (which: 'arms' | 'legs', deg: number): Poser => (rig, side) => {
  const j = rig[which][side].lower, L = rig.limits[j]!;
  const d = L.neutral.clone().multiplyScalar(Math.cos(deg * DEG)).addScaledVector(L.axisA, Math.sin(deg * DEG)).normalize();
  rig.setJoint(j, clampJoint(new Quaternion().setFromUnitVectors(Y, d), L));
  return j;
};

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
export const KEY_POSERS: Record<string, Poser> = {
  'shoulder-side': armAim(o => V(o, 0, 0)),
  'shoulder-up': armAim(o => V(o * 0.25, 1, 0.05)),
  'shoulder-forward': armAim(() => V(0, 0, 1)),
  'shoulder-forward-up': armAim(o => V(o * 0.1, 1, 0.45)),
  'shoulder-across': armAim(o => V(-o * 0.6, 0, 1)),
  'shoulder-back': armAim(o => V(o * 0.15, -0.7, -0.7)),
  'elbow-90': hinge('arms', 90),
  'elbow-145': hinge('arms', 145),
  'hip-forward': thighAim(() => V(0, 0, 1)),
  'hip-forward-up': thighAim(o => V(o * 0.15, 0.6, 0.8)),
  'hip-side': thighAim(o => V(o * Math.sin(50 * DEG), -Math.cos(50 * DEG), 0)),
  'hip-back': thighAim(() => V(0, -Math.cos(25 * DEG), -Math.sin(25 * DEG))),
  'knee-90': hinge('legs', 90),
  'knee-145': hinge('legs', 145),
};

/** Skinning matrices (bone world x inverse bind), column-major, for the figure's current pose. */
export function skinMatrices(fig: Figure) {
  fig.group.updateMatrixWorld(true);
  const sk = fig.mesh.skeleton, out = new Float32Array(sk.bones.length * 16), m = new Matrix4();
  sk.bones.forEach((b, i) => { m.multiplyMatrices(b.matrixWorld, sk.boneInverses[i]); out.set(m.elements, i * 16); });
  return out;
}

/** Pose every key in turn (both sides) and collect its skinning matrices; restores the pose afterwards. */
export function generateKeys(rig: PoseRig): { keys: KeyPose[]; mats: Float32Array[] } {
  const fig = rig.fig;
  const saved = { joints: fig.joints.map(q => q.clone()), root: fig.rootOffset.clone() };
  const keys: KeyPose[] = [], mats: Float32Array[] = [];
  for (const side of ['l', 'r'] as const) {
    for (const [name, pose] of Object.entries(KEY_POSERS)) {
      fig.resetPose();
      const joint = pose(rig, side);
      keys.push({ name: `${name}-${side}`, joint, centre: swingVector(fig.joints[joint]) });
      mats.push(skinMatrices(fig));
    }
  }
  saved.joints.forEach((q, i) => fig.joints[i].copy(q));
  fig.rootOffset.copy(saved.root);
  fig.applyPose();
  return { keys, mats };
}

/** Radial-basis mixer: per driver joint, influences of its keys from the joint's current swing. */
export class KeyMixer {
  private groups: { joint: number; keyIdx: number[]; centres: Vector3[]; A: number[][] }[] = [];
  constructor(keys: KeyPose[]) {
    const byJoint = new Map<number, number[]>();
    keys.forEach((k, i) => byJoint.set(k.joint, [...(byJoint.get(k.joint) ?? []), i]));
    for (const [joint, keyIdx] of byJoint) {
      const centres = [...keyIdx.map(i => keys[i].centre), new Vector3()]; // + rest: no correction
      const n = centres.length, k = keyIdx.length;
      const phi = (a: Vector3, b: Vector3) => Math.exp(-((a.distanceTo(b) / SIGMA) ** 2));
      const M = centres.map(a => centres.map(b => phi(a, b)));
      const T = centres.map((_, r) => Array.from({ length: k }, (__, c) => (r === c ? 1 : 0)));
      this.groups.push({ joint, keyIdx, centres, A: solve(M, T, n, k) });
    }
  }
  /** Influences (one per key) for the current joint rotations. */
  influences(joints: Quaternion[], out: number[]) {
    out.fill(0);
    for (const g of this.groups) {
      const r = swingVector(joints[g.joint]);
      const phi = g.centres.map(c => Math.exp(-((r.distanceTo(c) / SIGMA) ** 2)));
      g.keyIdx.forEach((ki, c) => {
        let v = 0;
        for (let i = 0; i < phi.length; i++) v += phi[i] * g.A[i][c];
        out[ki] = Math.min(Math.max(v, 0), 1.2);
      });
    }
    return out;
  }
}

/** Solve M X = T (M n x n, T n x k) by Gaussian elimination with partial pivoting (small systems). */
function solve(M: number[][], T: number[][], n: number, k: number) {
  const a = M.map((row, i) => [...row, ...T[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-12;
    for (let j = c; j < n + k; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f) for (let j = c; j < n + k; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map(row => row.slice(n));
}
