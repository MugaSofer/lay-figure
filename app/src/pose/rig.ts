// Posing operations on a Figure: joint limits, two-bone limb IK, aiming, hips with planted feet.
// The limb solver follows spike C (spikes/c-touch), whose jitter fixes are kept:
//  - the elbow/knee swivel is chosen by least change from the solver's last (unclamped) answer, with a
//    gentle pull toward a relaxed swivel only while the target moves, and limits/body as penalties;
//  - hand-held twist is unwrapped so it can't flip across 180 degrees;
//  - callers cap per-update joint motion (see PoseController).
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Figure } from '../body/figure';
import { capsules, fitRadii, sdf, type Capsule } from './colliders';
import { clampJoint, resolveLimit, specFor, swingTwist, type Limit } from './limits';

const Y = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

export interface Limb { upper: number; lower: number; end: number; flex: Vector3; side: 1 | -1 }

export class PoseRig {
  limits: (Limit | null)[] = [];
  limitsOn = true;
  radii: number[] = [];
  readonly arms: Record<'l' | 'r', Limb>;
  readonly legs: Record<'l' | 'r', Limb>;
  /** Bones whose capsules count as "the body" for keeping limbs out of it. */
  readonly trunk: number[];
  private lastIdeal = new Map<number, Quaternion>(); // per limb upper bone: last unclamped solution
  idle = false; // set while re-solving with a still finger: no drift toward the relaxed swivel

  constructor(readonly fig: Figure) {
    const b = (n: string) => fig.boneIndex.get(n)!;
    const limb = (u: string, l: string, e: string, flex: Vector3, side: 1 | -1): Limb => ({ upper: b(u), lower: b(l), end: b(e), flex, side });
    this.arms = { l: limb('upperarm_l', 'lowerarm_l', 'hand_l', FORWARD, 1), r: limb('upperarm_r', 'lowerarm_r', 'hand_r', FORWARD, -1) };
    const BACK = FORWARD.clone().negate();
    this.legs = { l: limb('thigh_l', 'calf_l', 'foot_l', BACK, 1), r: limb('thigh_r', 'calf_r', 'foot_r', BACK, -1) };
    this.trunk = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'].map(b);
    this.refresh();
  }

  /** Call after the figure's shape (and so its rest skeleton) changes. */
  refresh() {
    this.limits = this.fig.bones.map((bone, i) => {
      const spec = specFor(bone.name);
      return spec ? resolveLimit(spec, this.fig.rests[i].rotation, bone.name.endsWith('_r') ? -1 : 1) : null;
    });
    this.radii = fitRadii(this.fig);
  }

  // ---------- frames ----------
  worldQuat(i: number) { return this.fig.bones[i].getWorldQuaternion(new Quaternion()); }
  worldPos(i: number) { return this.fig.bones[i].getWorldPosition(new Vector3()); }
  parentWorldQuat(i: number) {
    const p = this.fig.bones[i].parent!;
    return p.getWorldQuaternion(new Quaternion());
  }
  /** Joint rotation that gives bone i the world rotation w. */
  jointFromWorld(i: number, w: Quaternion) {
    return this.fig.restLocal(i).clone().invert().multiply(this.parentWorldQuat(i).invert().multiply(w));
  }
  /** World rotation bone i would have with joint rotation q (parent as currently posed). */
  worldFromJoint(i: number, q: Quaternion) {
    return this.parentWorldQuat(i).multiply(this.fig.restLocal(i)).multiply(q);
  }
  clamp(i: number, q: Quaternion) {
    const L = this.limits[i];
    return this.limitsOn && L ? clampJoint(q, L) : q.clone();
  }
  setJoint(i: number, q: Quaternion) {
    this.fig.joints[i].copy(this.clamp(i, q));
    this.fig.applyPose();
  }
  setWorld(i: number, w: Quaternion) { this.setJoint(i, this.jointFromWorld(i, w)); }
  /** How far a joint rotation is outside its limit (radians). */
  violation(i: number, q: Quaternion) {
    const L = this.limits[i];
    return L ? clampJoint(q, L).angleTo(q) : 0;
  }

  bodyCapsules(exclude: number[] = []): Capsule[] {
    return capsules(this.fig, this.radii, this.trunk.filter(b => !exclude.includes(b)));
  }

  resetContinuity() { this.lastIdeal.clear(); }

  // ---------- two-bone limb IK ----------
  /** Bring the point `reach` along the lower bone to `target`. */
  solveLimb(limb: Limb, target: Vector3, reach: number) {
    const fig = this.fig;
    fig.group.updateMatrixWorld(true);
    const S = this.worldPos(limb.upper);
    const E0 = this.worldPos(limb.lower);
    const L1 = S.distanceTo(E0);
    const toT = target.clone().sub(S);
    const dist = Math.min(Math.max(toT.length(), Math.abs(L1 - reach) + 1e-4), L1 + reach - 1e-4);
    const dir = toT.normalize();
    const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - reach * reach) / (2 * L1 * dist)));
    const sinA = Math.sqrt(1 - cosA * cosA);

    // Hinge axis of the joint in the upper bone's frame: the lower bone flexes toward limb.flex at rest.
    const upRest = fig.rests[limb.upper].rotation, loRest = fig.rests[limb.lower].rotation;
    const loDirRest = Y.clone().applyQuaternion(loRest);
    const hingeWorldRest = new Vector3().crossVectors(loDirRest, limb.flex).normalize();
    const hingeUpLocal = hingeWorldRest.clone().applyQuaternion(upRest.clone().invert());
    hingeUpLocal.addScaledVector(Y, -hingeUpLocal.dot(Y)).normalize();
    const hingeLoLocal = hingeWorldRest.clone().applyQuaternion(loRest.clone().invert()).normalize();

    // Relaxed swivel: elbows hang down/out/back, knees point forward.
    const isLeg = limb.flex.z < 0;
    const relaxedWorld = isLeg ? new Vector3(0.15 * limb.side, -0.1, 1) : new Vector3(0.4 * limb.side, -1, -0.12);
    // (pole = the side the joint bulges toward; the limb folds away from it)
    let ref = relaxedWorld.clone().addScaledVector(dir, -relaxedWorld.dot(dir));
    if (ref.lengthSq() < 1e-6) ref = new Vector3(0, 0, isLeg ? 1 : -1).addScaledVector(dir, -dir.z);
    ref.normalize();
    const P = this.parentWorldQuat(limb.upper);
    const Pinv = P.clone().invert();
    const restLocalInv = fig.restLocal(limb.upper).clone().invert();
    const prev = this.lastIdeal.get(limb.upper) ?? fig.joints[limb.upper].clone();
    const caps = this.bodyCapsules();

    const candidate = (swivel: number) => {
      const pole = ref.clone().applyAxisAngle(dir, swivel);
      const u = dir.clone().multiplyScalar(cosA).addScaledVector(pole, sinA);
      // limb folds away from the pole: lower direction's perpendicular part is -pole; hinge = u x fold
      const fold = pole.clone().negate().addScaledVector(u, pole.dot(u)).normalize();
      const h = new Vector3().crossVectors(u, fold).normalize();
      // world frame of the upper bone: Y -> u, hingeLocal -> h
      const bl = new Matrix4().makeBasis(Y, hingeUpLocal, new Vector3().crossVectors(Y, hingeUpLocal));
      const bw = new Matrix4().makeBasis(u, h, new Vector3().crossVectors(u, h));
      const W = new Quaternion().setFromRotationMatrix(bw.multiply(bl.transpose()));
      const q = restLocalInv.clone().multiply(Pinv.clone().multiply(W));
      return { q, elbow: S.clone().addScaledVector(u, L1) };
    };
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const cost = (sw: number) => {
      const c = candidate(sw);
      const moved = c.q.angleTo(prev);
      let v = 4 * moved * moved + (this.idle ? 0 : 0.1) * Math.abs(wrap(sw));
      if (this.limitsOn) v += 4 * this.violation(limb.upper, c.q);
      const inside = 0.03 - sdf(c.elbow, caps);
      if (inside > 0) v += 8 * inside;
      return { v, q: c.q };
    };
    let bestS = 0, bestV = Infinity;
    for (let k = 0; k < 72; k++) { const r = cost((k * 5 * Math.PI) / 180); if (r.v < bestV) { bestV = r.v; bestS = (k * 5 * Math.PI) / 180; } }
    let best = cost(bestS).q;
    for (let k = -5; k <= 5; k++) { const r = cost(bestS + (k * Math.PI) / 180); if (r.v <= bestV) { bestV = r.v; best = r.q; } }
    this.lastIdeal.set(limb.upper, best.clone());
    this.setJoint(limb.upper, best);

    // Lower bone: keep its twist, bend about its hinge until it points at the target
    fig.group.updateMatrixWorld(true);
    const E = this.worldPos(limb.lower);
    const want = target.clone().sub(E).normalize();
    const { twist } = swingTwist(fig.joints[limb.lower]);
    const straight = this.worldFromJoint(limb.lower, twist); // hinge unbent, twist kept
    const curDir = Y.clone().applyQuaternion(straight);
    const hW = hingeLoLocal.clone().applyQuaternion(straight);
    const a = Math.atan2(hW.dot(new Vector3().crossVectors(curDir, want)), curDir.dot(want));
    this.setJoint(limb.lower, new Quaternion().setFromAxisAngle(hingeLoLocal, a).multiply(twist));
  }

  /** Keep an end bone (hand, foot) at a world rotation; for hands, pass excess twist to the forearm. */
  holdEnd(limb: Limb, worldRot: Quaternion, twistState: { goal: number | null }, passTwist: boolean) {
    const fig = this.fig;
    fig.group.updateMatrixWorld(true);
    if (passTwist) {
      const local = this.jointFromWorld(limb.end, worldRot);
      const { angle } = swingTwist(local);
      const lo = swingTwist(fig.joints[limb.lower]);
      let goal = lo.angle + angle;
      if (twistState.goal !== null) goal += 2 * Math.PI * Math.round((twistState.goal - goal) / (2 * Math.PI));
      twistState.goal = goal;
      this.setJoint(limb.lower, lo.swing.clone().multiply(new Quaternion().setFromAxisAngle(Y, goal)));
      fig.group.updateMatrixWorld(true);
    }
    this.setWorld(limb.end, worldRot);
  }

  // ---------- aiming ----------
  /** Rotate bone i (minimal rotation) so the point `along` its axis heads toward target. */
  aim(i: number, target: Vector3) {
    this.fig.group.updateMatrixWorld(true);
    const p = this.worldPos(i), w = this.worldQuat(i);
    const cur = Y.clone().applyQuaternion(w);
    const want = target.clone().sub(p);
    if (want.lengthSq() < 1e-10) return;
    this.setWorld(i, new Quaternion().setFromUnitVectors(cur, want.normalize()).multiply(w));
  }

  /** Spread an aim over a chain (e.g. neck + head, spine). Each bone, in order, turns by its share of the
   *  rotation still remaining (seen from its own pivot); a final share of 1 finishes the job.
   *  tipOf() gives the grabbed point's current world position (it moves as the chain turns). */
  aimChain(chain: number[], shares: number[], tipOf: () => Vector3, target: Vector3) {
    const fig = this.fig;
    for (let k = 0; k < chain.length; k++) {
      fig.group.updateMatrixWorld(true);
      const pivot = this.worldPos(chain[k]);
      const from = tipOf().sub(pivot), to = target.clone().sub(pivot);
      if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) continue;
      const need = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      const part = new Quaternion().slerp(need, shares[k]);
      this.setWorld(chain[k], part.multiply(this.worldQuat(chain[k])));
    }
  }
}
