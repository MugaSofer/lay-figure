// Gestures -> posing. Tap selects a body part, drag poses it (IK or aim, depending on the part),
// long-press shows rotation rings. Undo/redo, mirror and the joint-limit switch live here too.
import { BufferAttribute, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { GpuPicker } from '../view/picker';
import type { Figure } from '../body/figure';
import type { PoseInput } from '../view/input';
import { Rings, AXES, type Axis } from '../view/rings';
import type { Stage } from '../view/stage';
import { sdf } from './colliders';
import { mirrorPose, type MirrorMode } from './mirror';
import { PoseRig, type Limb } from './rig';

const MAX_STEP = (15 * Math.PI) / 180; // per-update cap on joint motion (spike C)
const HIGHLIGHT = [1.0, 0.72, 0.42];

export interface PoseSnapshot { joints: Quaternion[]; root: Vector3 }

type Drag =
  | { kind: 'limb'; limb: Limb; reach: number; grabOffset: Vector3; plane: Vector3; margin: number; hold: Quaternion | null; passTwist: boolean; twist: { goal: number | null }; exclude: number[] }
  | { kind: 'aim'; bone: number; grabLocal: Vector3; plane: Vector3; grabOffset: Vector3 }
  | { kind: 'chain'; chain: number[]; shares: number[]; tipLocal: Vector3; tipBone: number; plane: Vector3; grabOffset: Vector3 }
  | { kind: 'hips'; plane: Vector3; startRoot: Vector3; startPoint: Vector3; feet: { limb: Limb; pos: Vector3; rot: Quaternion; twist: { goal: number | null } }[] }
  | { kind: 'ring'; bone: number; axis: Axis; dir: Vector2; radiusPx: number; last: Vector2 };

export class PoseController implements PoseInput {
  readonly rig: PoseRig;
  readonly rings = new Rings();
  selected = -1;
  holdHands = true;
  onChange: () => void = () => {};
  private ray = new Raycaster();
  private drag: Drag | null = null;
  private last = new Vector2();
  private undoStack: PoseSnapshot[] = [];
  private redoStack: PoseSnapshot[] = [];
  private before: PoseSnapshot | null = null;
  private picker: GpuPicker;

  constructor(readonly fig: Figure, readonly stage: Stage) {
    this.rig = new PoseRig(fig);
    stage.scene.add(this.rings.group);
    const { data } = fig;
    this.picker = new GpuPicker(stage.renderer, fig);
    fig.onRebuild.push(() => { this.picker.rebind(); this.rig.refresh(); });
    const geo = fig.mesh.geometry;
    geo.setAttribute('color', new BufferAttribute(new Float32Array(data.meta.renderVertexCount * 3).fill(1), 3));
    (fig.mesh.material as { vertexColors: boolean }).vertexColors = true;
    stage.onFrame.push(() => this.frame());
  }

  // ---------- picking ----------
  private rayAt(x: number, y: number) {
    const r = this.stage.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.stage.camera);
    return this.ray;
  }
  private toScreen = (p: Vector3) => {
    const v = p.clone().project(this.stage.camera), r = this.stage.canvas.getBoundingClientRect();
    return new Vector2(r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height);
  };
  private pickCache: { x: number; y: number; frame: number; hit: { bone: number; point: Vector3 } | null } | null = null;
  private frameNo = 0;
  /** Bone and world point under (x, y), via GPU picking; cached within a frame. */
  private pickBody(x: number, y: number) {
    const c = this.pickCache;
    if (c && c.x === x && c.y === y && c.frame === this.frameNo) return c.hit;
    const r = this.stage.canvas.getBoundingClientRect();
    this.fig.group.updateMatrixWorld(true);
    const hit = this.picker.pick(this.stage.camera, x - r.left, y - r.top);
    this.pickCache = { x, y, frame: this.frameNo, hit };
    return hit;
  }

  hitTest(x: number, y: number) {
    if (this.rings.visible) {
      this.placeRings();
      if (this.rings.pick(this.rayAt(x, y))) return 'ring' as const;
    }
    return this.pickBody(x, y) ? ('body' as const) : null;
  }

  // ---------- selection ----------
  select(bone: number, rings: boolean) {
    this.selected = bone;
    if (rings && bone >= 0) this.rings.show(bone); else this.rings.hide();
    this.paintHighlight();
    this.onChange();
  }
  private paintHighlight() {
    const { data } = this.fig, inf = data.meta.maxInfluences;
    const col = this.fig.mesh.geometry.getAttribute('color') as BufferAttribute;
    const a = col.array as Float32Array;
    for (let r = 0; r < data.meta.renderVertexCount; r++) {
      const s = data.renderToShape[r];
      let w = 0;
      if (this.selected >= 0) for (let k = 0; k < inf; k++) if (data.skinIndex[s * inf + k] === this.selected) w += data.skinWeight[s * inf + k];
      for (let c = 0; c < 3; c++) a[r * 3 + c] = 1 + (HIGHLIGHT[c] - 1) * w;
    }
    col.needsUpdate = true;
  }

  tap(x: number, y: number) {
    const p = this.pickBody(x, y);
    if (!p) return;
    const b = this.handleBone(p.bone);
    // tapping the part whose rings are showing puts them away
    this.select(b, false);
  }
  longPress(x: number, y: number) {
    const p = this.pickBody(x, y);
    if (p) this.select(p.bone, true);
  }
  tapEmpty() { this.select(-1, false); }

  /** Which bone a touch on bone b poses: hips for the pelvis region, etc. */
  private handleBone(b: number) {
    const n = this.fig.bones[b].name;
    if (n === 'Root') return this.fig.boneIndex.get('pelvis')!;
    return b;
  }

  // ---------- dragging ----------
  private dragPoint(x: number, y: number, through: Vector3) {
    const n = this.stage.camera.getWorldDirection(new Vector3());
    return this.rayAt(x, y).ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(n, through), new Vector3()) ?? through.clone();
  }

  beginDrag(x0: number, y0: number, x: number, y: number, kind: 'ring' | 'body') {
    this.before = this.snapshot();
    this.rig.resetContinuity();
    this.last.set(x, y);
    if (kind === 'ring') {
      this.placeRings();
      const hit = this.rings.pick(this.rayAt(x0, y0));
      if (!hit) return;
      const f = this.rings.dragFrame(hit, this.toScreen);
      this.drag = { kind: 'ring', bone: this.rings.bone, axis: f.axis, dir: f.dir, radiusPx: f.radiusPx, last: new Vector2(x, y) };
      return;
    }
    const p = this.pickBody(x0, y0);
    if (!p) return;
    const bone = this.handleBone(p.bone);
    this.select(bone, false);
    this.drag = this.makeDrag(bone, p.point);
    // measure the drag from where it begins, not from touch-down (spike C: no jump from the slop)
    const d = this.drag as { plane?: Vector3; grabOffset?: Vector3 } | null;
    if (d?.plane && d.grabOffset) d.grabOffset.add(this.dragPoint(x, y, d.plane).sub(d.plane));
    if (this.drag?.kind === 'hips') this.drag.startPoint.copy(this.dragPoint(x, y, this.drag.plane));
    this.moveDrag(x, y);
  }

  private makeDrag(bone: number, point: Vector3): Drag | null {
    const fig = this.fig, rig = this.rig, name = fig.bones[bone].name;
    const side = name.endsWith('_l') ? 'l' : 'r';
    fig.group.updateMatrixWorld(true);
    const along = (b: number) => {
      const local = fig.bones[b].worldToLocal(point.clone());
      return Math.min(Math.max(local.y, 0.02), fig.rests[b].length);
    };
    const axisPoint = (b: number, t: number) => new Vector3(0, t, 0).applyMatrix4(fig.bones[b].matrixWorld);
    const margin = (exclude: number[]) => Math.min(Math.max(sdf(point, rig.bodyCapsules(exclude)), 0), 0.05);
    const isHand = /^(hand|thumb|index|middle|ring|pinky)/.test(name);
    const isFoot = /^(foot|ball)_/.test(name);
    if (isHand || isFoot) {
      const limb = isHand ? rig.arms[side] : rig.legs[side];
      const wrist = rig.worldPos(limb.end);
      const reach = wrist.distanceTo(rig.worldPos(limb.lower));
      const hold = isFoot || this.holdHands ? rig.worldQuat(limb.end) : null;
      return { kind: 'limb', limb, reach, grabOffset: point.clone().sub(wrist), plane: point.clone(), margin: margin([]), hold, passTwist: isHand, twist: { goal: null }, exclude: [] };
    }
    if (/^(lowerarm|calf)_/.test(name)) {
      const limb = name.startsWith('lowerarm') ? rig.arms[side] : rig.legs[side];
      const t = along(bone);
      return { kind: 'limb', limb, reach: t, grabOffset: point.clone().sub(axisPoint(bone, t)), plane: point.clone(), margin: margin([]), hold: null, passTwist: false, twist: { goal: null }, exclude: [] };
    }
    if (/^(upperarm|thigh|clavicle)_/.test(name)) {
      const t = along(bone);
      return { kind: 'aim', bone, grabLocal: new Vector3(0, t, 0), plane: point.clone(), grabOffset: point.clone().sub(axisPoint(bone, t)) };
    }
    const b = (n: string) => fig.boneIndex.get(n)!;
    if (name === 'head' || name === 'neck_01') {
      const tipBone = bone;
      return { kind: 'chain', chain: [b('neck_01'), b('head')], shares: [0.4, 1], tipBone, tipLocal: fig.bones[tipBone].worldToLocal(point.clone()), plane: point.clone(), grabOffset: new Vector3() };
    }
    if (name === 'spine_02' || name === 'spine_03') {
      return { kind: 'chain', chain: [b('spine_01'), b('spine_02'), b('spine_03')], shares: [1 / 3, 1 / 2, 1], tipBone: bone, tipLocal: fig.bones[bone].worldToLocal(point.clone()), plane: point.clone(), grabOffset: new Vector3() };
    }
    // pelvis / lower spine: move the hips, feet stay planted
    const feet = (['l', 'r'] as const).map(s => ({ limb: rig.legs[s], pos: rig.worldPos(rig.legs[s].end), rot: rig.worldQuat(rig.legs[s].end), twist: { goal: null as number | null } }));
    return { kind: 'hips', plane: point.clone(), startRoot: fig.rootOffset.clone(), startPoint: point.clone(), feet };
  }

  private lastX = 0; private lastY = 0; private dragging = false;
  moveDrag(x: number, y: number) {
    this.lastX = x; this.lastY = y; this.dragging = true;
    this.rig.idle = false;
    this.step(x, y);
  }

  /** One posing update toward the finger, with the per-update rotation cap. */
  private step(x: number, y: number) {
    const d = this.drag;
    if (!d) return;
    const fig = this.fig, rig = this.rig;
    const before = fig.joints.map(q => q.clone());
    switch (d.kind) {
      case 'ring': {
        const cur = new Vector2(x, y);
        const delta = cur.clone().sub(d.last).dot(d.dir) / d.radiusPx;
        d.last = cur;
        if (rig.idle) return;
        rig.setJoint(d.bone, fig.joints[d.bone].clone().multiply(new Quaternion().setFromAxisAngle(AXES[d.axis], delta)));
        break;
      }
      case 'limb': {
        const p = this.dragPoint(x, y, d.plane);
        // drag plane has no depth sense: slide out of the body toward the camera (smooth, so no jumps)
        const caps = rig.bodyCapsules();
        if (sdf(p, caps) < d.margin) {
          const back = this.rayAt(x, y).ray.direction.clone().negate();
          let lo = 0, hi = 0.02;
          while (hi < 0.8 && sdf(p.clone().addScaledVector(back, hi), caps) < d.margin) { lo = hi; hi *= 1.6; }
          for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (sdf(p.clone().addScaledVector(back, m), caps) < d.margin) lo = m; else hi = m; }
          p.addScaledVector(back, hi);
        }
        rig.solveLimb(d.limb, p.sub(d.grabOffset), d.reach);
        if (d.hold) rig.holdEnd(d.limb, d.hold, d.twist, d.passTwist);
        break;
      }
      case 'aim':
        rig.aim(d.bone, this.dragPoint(x, y, d.plane).sub(d.grabOffset));
        break;
      case 'chain': {
        const tipOf = () => fig.bones[d.tipBone].localToWorld(d.tipLocal.clone());
        rig.aimChain(d.chain, d.shares, tipOf, this.dragPoint(x, y, d.plane));
        break;
      }
      case 'hips': {
        const p = this.dragPoint(x, y, d.plane);
        fig.rootOffset.copy(d.startRoot).add(p.sub(d.startPoint));
        fig.applyPose();
        for (const f of d.feet) {
          rig.solveLimb(f.limb, f.pos, fig.rests[f.limb.lower].length);
          rig.holdEnd(f.limb, f.rot, f.twist, false);
        }
        break;
      }
    }
    // cap per-update motion; the per-frame re-solve finishes larger moves as a quick swing
    for (let i = 0; i < before.length; i++) {
      const q = fig.joints[i], a = before[i].angleTo(q);
      if (a > MAX_STEP) q.copy(before[i].slerp(q.clone(), MAX_STEP / a));
    }
    fig.applyPose();
  }

  endDrag() {
    this.drag = null;
    this.dragging = false;
    this.commit();
  }

  /** Per frame: keep solving toward a still finger (idle: no relaxed-swivel drift), keep rings placed. */
  private frame() {
    this.frameNo++;
    if (this.dragging && this.drag && this.drag.kind !== 'ring') {
      this.rig.idle = true;
      this.step(this.lastX, this.lastY);
      this.rig.idle = false;
    }
    if (this.rings.visible) this.placeRings();
  }

  private placeRings() {
    const b = this.rings.bone;
    if (b < 0) return;
    this.fig.group.updateMatrixWorld(true);
    this.rings.place(this.rig.worldPos(b), this.rig.worldQuat(b), this.stage.camera, this.stage.canvas.clientHeight);
  }

  // ---------- history ----------
  snapshot(): PoseSnapshot { return { joints: this.fig.joints.map(q => q.clone()), root: this.fig.rootOffset.clone() }; }
  restore(s: PoseSnapshot) {
    s.joints.forEach((q, i) => this.fig.joints[i].copy(q));
    this.fig.rootOffset.copy(s.root);
    this.fig.applyPose();
    this.onChange();
  }
  private same(a: PoseSnapshot, b: PoseSnapshot) {
    return a.root.distanceTo(b.root) < 1e-6 && a.joints.every((q, i) => q.angleTo(b.joints[i]) < 1e-6);
  }
  /** Record a change made since `before` (or since the last gesture began). */
  commit(before = this.before) {
    if (before && !this.same(before, this.snapshot())) {
      this.undoStack.push(before);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.before = null;
    this.onChange();
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() { const s = this.undoStack.pop(); if (s) { this.redoStack.push(this.snapshot()); this.restore(s); } }
  redo() { const s = this.redoStack.pop(); if (s) { this.undoStack.push(this.snapshot()); this.restore(s); } }

  /** Run a whole-pose edit as one undo step. */
  edit(fn: () => void) {
    const before = this.snapshot();
    fn();
    this.fig.applyPose();
    this.commit(before);
  }

  setLimits(on: boolean) {
    this.rig.limitsOn = on;
    if (on) this.edit(() => this.fig.joints.forEach((q, i) => q.copy(this.rig.clamp(i, q))));
    this.onChange();
  }

  /** Mirror the pose (whole body, or only copy one side onto the other). */
  mirror(mode: MirrorMode) {
    this.edit(() => mirrorPose(this.fig, mode));
  }
}
