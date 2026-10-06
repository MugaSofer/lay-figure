// Anatomical joint limits. Written in body terms ("upper arm: 170 deg forward, 45 deg across the body")
// and converted into each bone's rest frame at load, so they hold on every body shape.
//
// Each joint's rotation is split into swing (where the bone points) and twist (about its own axis,
// local +Y). Swing is limited by an angle per direction of travel from a neutral direction; twist by a
// range. Directions between the four listed ones are interpolated around the circle.
import { Quaternion, Vector3 } from 'three';

export type Dir = 'up' | 'down' | 'forward' | 'back' | 'out' | 'in';
export interface LimitSpec {
  /** Neutral direction the swing is measured from; omit to use the rest direction. */
  neutral?: Dir | [Dir, Dir, number]; // [a, b, deg]: tilted from a toward b
  /** Max swing (degrees) toward each of four directions around the neutral. */
  swing: Partial<Record<Dir, number>>;
  twist: [number, number];
}

const LIMB = (s: LimitSpec) => s;
// Sided specs use out/in; the side is resolved per bone.
export const LIMITS: Record<string, LimitSpec> = {
  // arms
  clavicle: LIMB({ swing: { up: 25, down: 8, forward: 18, back: 15 }, twist: [-5, 5] }),
  upperarm: LIMB({ neutral: 'down', swing: { forward: 175, back: 60, out: 178, in: 45 }, twist: [-80, 80] }),
  lowerarm: LIMB({ swing: { forward: 150, back: 2, out: 3, in: 3 }, twist: [-85, 85] }),
  hand: LIMB({ swing: { in: 80, out: 70, forward: 25, back: 35 }, twist: [-5, 5] }),
  // legs
  thigh: LIMB({ neutral: 'down', swing: { forward: 125, back: 30, out: 55, in: 30 }, twist: [-40, 40] }),
  calf: LIMB({ swing: { back: 150, forward: 2, out: 2, in: 2 }, twist: [-8, 8] }),
  foot: LIMB({ swing: { up: 25, down: 50, in: 25, out: 20 }, twist: [-15, 15] }),
  ball: LIMB({ swing: { up: 60, down: 30, in: 3, out: 3 }, twist: [-2, 2] }),
  // trunk and head (centre bones: "out"/"in" mean the figure's left/right)
  pelvis: LIMB({ swing: { forward: 30, back: 25, out: 20, in: 20 }, twist: [-30, 30] }),
  spine_01: LIMB({ swing: { forward: 30, back: 15, out: 15, in: 15 }, twist: [-12, 12] }),
  spine_02: LIMB({ swing: { forward: 25, back: 15, out: 15, in: 15 }, twist: [-15, 15] }),
  spine_03: LIMB({ swing: { forward: 20, back: 15, out: 12, in: 12 }, twist: [-15, 15] }),
  neck_01: LIMB({ swing: { forward: 35, back: 40, out: 30, in: 30 }, twist: [-40, 40] }),
  head: LIMB({ swing: { forward: 30, back: 30, out: 20, in: 20 }, twist: [-45, 45] }),
};

const WORLD: Record<Dir, Vector3> = {
  up: new Vector3(0, 1, 0), down: new Vector3(0, -1, 0), forward: new Vector3(0, 0, 1), back: new Vector3(0, 0, -1),
  out: new Vector3(1, 0, 0), in: new Vector3(-1, 0, 0), // for the figure's left side; mirrored for the right
};
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', forward: 'back', back: 'forward', out: 'in', in: 'out' };

/** A limit resolved into one bone's rest frame. */
export interface Limit {
  neutral: Vector3; // unit, rest frame
  axisA: Vector3; axisB: Vector3; // orthonormal, perpendicular to neutral: "first" and "second" directions
  maxA: [number, number]; maxB: [number, number]; // radians toward +A/-A, +B/-B
  twist: [number, number];
}

export function specFor(boneName: string): LimitSpec | null {
  const base = boneName.replace(/_[lr]$/, '');
  return LIMITS[base] ?? (/^(thumb|index|middle|ring|pinky)_0[123]_[lr]$/.test(boneName) ? FINGER : null);
}
const FINGER: LimitSpec = { swing: { in: 100, out: 30, forward: 20, back: 20 }, twist: [-10, 10] };

/** side: +1 for the figure's left (and centre bones), -1 for its right. restWorld: bone rest rotation. */
export function resolveLimit(spec: LimitSpec, restWorld: Quaternion, side: 1 | -1): Limit {
  const inv = restWorld.clone().invert();
  const w = (d: Dir) => {
    const v = WORLD[d].clone();
    if (d === 'out' || d === 'in') v.x *= side;
    return v.applyQuaternion(inv); // into the rest frame
  };
  const Y = new Vector3(0, 1, 0);
  let neutral = Y.clone();
  if (spec.neutral) {
    if (Array.isArray(spec.neutral)) {
      const [a, b, deg] = spec.neutral, r = (deg * Math.PI) / 180;
      neutral = w(a).multiplyScalar(Math.cos(r)).addScaledVector(w(b), Math.sin(r)).normalize();
    } else neutral = w(spec.neutral);
  }
  const dirs = Object.keys(spec.swing) as Dir[];
  // first axis: a listed direction perpendicular-ish to neutral; second: the other pair
  const pairs: [Dir, Dir][] = [['forward', 'back'], ['out', 'in'], ['up', 'down']];
  const usable = pairs.filter(([p, q]) => dirs.includes(p) || dirs.includes(q));
  const [pa, pb] = usable.length >= 2 ? [usable[0], usable[1]] : [pairs[0], pairs[1]];
  const perp = (v: Vector3) => v.clone().addScaledVector(neutral, -v.dot(neutral)).normalize();
  const axisA = perp(w(pa[0]));
  const axisB = perp(w(pb[0]).addScaledVector(axisA, -w(pb[0]).dot(axisA)));
  const rad = (d: Dir) => ((spec.swing[d] ?? spec.swing[OPP[d]] ?? 30) * Math.PI) / 180;
  return {
    neutral, axisA, axisB,
    maxA: [rad(pa[0]), rad(pa[1])], maxB: [rad(pb[0]), rad(pb[1])],
    twist: [(spec.twist[0] * Math.PI) / 180, (spec.twist[1] * Math.PI) / 180],
  };
}

const Y = new Vector3(0, 1, 0);

export function swingTwist(q: Quaternion, axis = Y) {
  const p = new Vector3(q.x, q.y, q.z);
  const proj = axis.clone().multiplyScalar(p.dot(axis));
  const twist = new Quaternion(proj.x, proj.y, proj.z, q.w);
  if (twist.lengthSq() < 1e-12) twist.identity(); else twist.normalize();
  if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w);
  const swing = q.clone().multiply(twist.clone().invert());
  const angle = 2 * Math.atan2(new Vector3(twist.x, twist.y, twist.z).dot(axis), twist.w);
  return { swing, twist, angle };
}

/** Clamp a joint rotation (relative to rest, in the rest frame) to its limit. Returns a new quaternion. */
export function clampJoint(q: Quaternion, L: Limit): Quaternion {
  const { swing, angle } = swingTwist(q);
  const twist = Math.min(Math.max(angle, L.twist[0]), L.twist[1]);
  // where the bone points, measured from the neutral direction as a 2D rotation vector
  const d = Y.clone().applyQuaternion(swing);
  const theta = Math.acos(Math.min(1, Math.max(-1, d.dot(L.neutral))));
  let d2 = d;
  if (theta > 1e-6) {
    const pa = d.dot(L.axisA), pb = d.dot(L.axisB);
    const h = Math.hypot(pa, pb);
    if (h > 1e-9) {
      const ca = pa / h, cb = pb / h; // direction of travel
      const ra = ca >= 0 ? L.maxA[0] : L.maxA[1], rb = cb >= 0 ? L.maxB[0] : L.maxB[1];
      // elliptical interpolation of the max angle between the four listed directions
      const max = 1 / Math.sqrt((ca * ca) / (ra * ra || 1e-9) + (cb * cb) / (rb * rb || 1e-9));
      if (theta > max) {
        const t = L.axisA.clone().multiplyScalar(ca).addScaledVector(L.axisB, cb).normalize();
        d2 = L.neutral.clone().multiplyScalar(Math.cos(max)).addScaledVector(t, Math.sin(max));
      }
    }
  }
  // rebuild: minimal swing from rest +Y to d2, then the twist about the bone
  const s = new Quaternion().setFromUnitVectors(Y, d2.normalize());
  return s.multiply(new Quaternion().setFromAxisAngle(Y, twist));
}
